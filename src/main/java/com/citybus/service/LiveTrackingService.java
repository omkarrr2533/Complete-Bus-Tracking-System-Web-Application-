package com.citybus.service;

import com.citybus.dto.LiveBusDto;
import com.citybus.util.GeoUtils;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Single source of truth for ephemeral real-time state: which drivers and
 * riders are connected, where every bus currently is, and how fast it is
 * moving. Deliberately in-memory — GPS pings arrive every few seconds per bus
 * and have no long-term value, so they never touch the relational store
 * (write-path isolation). Speed is measured from a ring buffer of recent
 * pings rather than assumed, which feeds honest ETAs to riders.
 */
@Service
public class LiveTrackingService {

    public static final double PROXIMITY_THRESHOLD_KM = 0.5;
    private static final int RING_BUFFER_SIZE = 60;
    private static final long PROXIMITY_COOLDOWN_MS = 2 * 60 * 1000;
    private static final long MIN_SAMPLE_GAP_MS = 500;
    private static final double MAX_PLAUSIBLE_SPEED_KMH = 120.0;

    public enum ClientType { USER, DRIVER }

    /** Crowding level reported by the driver with one tap. */
    public enum Occupancy { LOW, MEDIUM, FULL }

    /** One GPS fix. */
    public record TimedPoint(double lat, double lng, long timestamp) {
    }

    /** A connected WebSocket client (rider or driver). */
    public static final class ClientSession {
        private final String sessionId;
        private final ClientType type;
        private final String clientId;
        private final String busCode;          // drivers: the bus they operate
        private volatile String trackingBusCode; // riders: the bus they follow
        private volatile Integer subscribedRouteNumber; // riders: route filter, null = all
        private volatile double[] coords;
        private volatile long lastSeen;
        private volatile long lastProximityAlert;

        ClientSession(String sessionId, ClientType type, String clientId, String busCode) {
            this.sessionId = sessionId;
            this.type = type;
            this.clientId = clientId;
            this.busCode = busCode;
            this.lastSeen = System.currentTimeMillis();
        }

        public String getSessionId() {
            return sessionId;
        }

        public ClientType getType() {
            return type;
        }

        public String getClientId() {
            return clientId;
        }

        public String getBusCode() {
            return busCode;
        }

        public String getTrackingBusCode() {
            return trackingBusCode;
        }

        /** Route this rider is watching; null means the whole network. */
        public Integer getSubscribedRouteNumber() {
            return subscribedRouteNumber;
        }

        /** True if this rider should receive updates about the given route. */
        public boolean wantsRoute(Integer routeNumber) {
            Integer subscribed = subscribedRouteNumber;
            return subscribed == null || routeNumber == null || subscribed.equals(routeNumber);
        }

        public double[] getCoords() {
            return coords;
        }

        public long getLastSeen() {
            return lastSeen;
        }
    }

    /** Live telemetry for one bus, with a bounded history for speed estimation. */
    public static final class LiveBusState {
        private final String busCode;
        private final String driverId;
        private final Integer routeNumber;
        private final String routeColor;
        private final Deque<TimedPoint> recent = new ArrayDeque<>(RING_BUFFER_SIZE);
        private volatile boolean visible = true;
        private volatile Double accuracy;
        private volatile long lastSeen;
        private volatile Occupancy occupancy;

        LiveBusState(String busCode, String driverId) {
            this(busCode, driverId, null, null);
        }

        LiveBusState(String busCode, String driverId, Integer routeNumber, String routeColor) {
            this.busCode = busCode;
            this.driverId = driverId;
            this.routeNumber = routeNumber;
            this.routeColor = routeColor;
            this.lastSeen = System.currentTimeMillis();
        }

        synchronized void addPoint(double lat, double lng, long timestamp) {
            if (recent.size() == RING_BUFFER_SIZE) {
                recent.pollFirst();
            }
            recent.addLast(new TimedPoint(lat, lng, timestamp));
            lastSeen = timestamp;
        }

        synchronized Optional<TimedPoint> latest() {
            return Optional.ofNullable(recent.peekLast());
        }

        synchronized List<TimedPoint> historySnapshot() {
            return new ArrayList<>(recent);
        }

        /**
         * Rolling average speed over the buffered window. Returns empty until
         * enough movement has been observed to be meaningful.
         */
        synchronized Optional<Double> speedKmh() {
            if (recent.size() < 2) {
                return Optional.empty();
            }
            double totalKm = 0;
            long totalMs = 0;
            TimedPoint prev = null;
            for (TimedPoint p : recent) {
                if (prev != null) {
                    long dt = p.timestamp() - prev.timestamp();
                    if (dt >= MIN_SAMPLE_GAP_MS) {
                        totalKm += GeoUtils.distanceKm(prev.lat(), prev.lng(), p.lat(), p.lng());
                        totalMs += dt;
                    }
                }
                prev = p;
            }
            if (totalMs < 3000) {
                return Optional.empty();
            }
            double kmh = totalKm / (totalMs / 3_600_000.0);
            return Optional.of(Math.min(kmh, MAX_PLAUSIBLE_SPEED_KMH));
        }

        public String getBusCode() {
            return busCode;
        }

        public String getDriverId() {
            return driverId;
        }

        public boolean isVisible() {
            return visible;
        }

        public long getLastSeen() {
            return lastSeen;
        }

        public Integer getRouteNumber() {
            return routeNumber;
        }

        public Occupancy getOccupancy() {
            return occupancy;
        }
    }

    /** A pending "your bus is close" notification for one rider session. */
    public record ProximityAlert(String sessionId, String busCode, double distanceKm) {
    }

    private final Map<String, ClientSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, LiveBusState> liveBuses = new ConcurrentHashMap<>();

    // ── Session lifecycle ──────────────────────────────────────────────

    public ClientSession registerDriver(String sessionId, String driverId, String busCode) {
        return registerDriver(sessionId, driverId, busCode, null, null);
    }

    public ClientSession registerDriver(String sessionId, String driverId, String busCode,
                                        Integer routeNumber, String routeColor) {
        ClientSession session = new ClientSession(sessionId, ClientType.DRIVER, driverId, busCode);
        sessions.put(sessionId, session);
        liveBuses.put(busCode, new LiveBusState(busCode, driverId, routeNumber, routeColor));
        return session;
    }

    public ClientSession registerUser(String sessionId, String userId) {
        ClientSession session = new ClientSession(sessionId, ClientType.USER, userId, null);
        sessions.put(sessionId, session);
        return session;
    }

    public Optional<ClientSession> getSession(String sessionId) {
        return Optional.ofNullable(sessions.get(sessionId));
    }

    /** Removes the session; if it was a driver, also retires their bus. */
    public Optional<ClientSession> removeSession(String sessionId) {
        ClientSession session = sessions.remove(sessionId);
        if (session != null && session.type == ClientType.DRIVER && session.busCode != null) {
            liveBuses.remove(session.busCode);
        }
        return Optional.ofNullable(session);
    }

    // ── Telemetry ──────────────────────────────────────────────────────

    public Optional<LiveBusDto> updateDriverLocation(String sessionId, double lat, double lng,
                                                     Double accuracy, Boolean visible) {
        ClientSession session = sessions.get(sessionId);
        if (session == null || session.type != ClientType.DRIVER) {
            return Optional.empty();
        }
        if (!GeoUtils.isValidLatitude(lat) || !GeoUtils.isValidLongitude(lng)) {
            return Optional.empty();
        }
        long now = System.currentTimeMillis();
        session.coords = new double[]{lat, lng};
        session.lastSeen = now;

        LiveBusState state = liveBuses.get(session.busCode);
        if (state == null) {
            state = liveBuses.computeIfAbsent(session.busCode,
                    code -> new LiveBusState(code, session.clientId));
        }
        state.addPoint(lat, lng, now);
        if (accuracy != null) {
            state.accuracy = accuracy;
        }
        if (visible != null) {
            state.visible = visible;
        }
        return Optional.of(toDto(state));
    }

    public void updateUserLocation(String sessionId, double lat, double lng) {
        ClientSession session = sessions.get(sessionId);
        if (session != null && GeoUtils.isValidLatitude(lat) && GeoUtils.isValidLongitude(lng)) {
            session.coords = new double[]{lat, lng};
            session.lastSeen = System.currentTimeMillis();
        }
    }

    public void trackBus(String sessionId, String busCode) {
        ClientSession session = sessions.get(sessionId);
        if (session != null) {
            session.trackingBusCode = busCode;
            session.lastSeen = System.currentTimeMillis();
        }
    }

    /** Rider narrows live updates to one route (null = whole network again). */
    public void subscribeRoute(String sessionId, Integer routeNumber) {
        ClientSession session = sessions.get(sessionId);
        if (session != null && session.type == ClientType.USER) {
            session.subscribedRouteNumber = routeNumber;
            session.lastSeen = System.currentTimeMillis();
        }
    }

    /** Driver's one-tap crowding report for their bus. */
    public Optional<LiveBusDto> setOccupancy(String sessionId, Occupancy occupancy) {
        ClientSession session = sessions.get(sessionId);
        if (session == null || session.type != ClientType.DRIVER || session.busCode == null) {
            return Optional.empty();
        }
        LiveBusState state = liveBuses.get(session.busCode);
        if (state == null) {
            return Optional.empty();
        }
        state.occupancy = occupancy;
        session.lastSeen = System.currentTimeMillis();
        return Optional.of(toDto(state));
    }

    public void setDriverVisibility(String driverId, boolean visible) {
        liveBuses.values().stream()
                .filter(state -> driverId.equals(state.getDriverId()))
                .forEach(state -> state.visible = visible);
    }

    public void touch(String sessionId) {
        ClientSession session = sessions.get(sessionId);
        if (session != null) {
            session.lastSeen = System.currentTimeMillis();
        }
    }

    // ── Queries ────────────────────────────────────────────────────────

    public List<LiveBusDto> snapshotVisibleBuses() {
        return liveBuses.values().stream()
                .filter(LiveBusState::isVisible)
                .filter(state -> state.latest().isPresent())
                .map(this::toDto)
                .toList();
    }

    public Optional<LiveBusDto> liveBus(String busCode) {
        return Optional.ofNullable(liveBuses.get(busCode)).map(this::toDto);
    }

    public List<TimedPoint> history(String busCode) {
        LiveBusState state = liveBuses.get(busCode);
        return state == null ? List.of() : state.historySnapshot();
    }

    public List<ClientSession> userSessions() {
        return sessions.values().stream()
                .filter(s -> s.type == ClientType.USER)
                .toList();
    }

    public List<ClientSession> driverSessions() {
        return sessions.values().stream()
                .filter(s -> s.type == ClientType.DRIVER)
                .toList();
    }

    /**
     * Riders who follow a bus that is now within {@value PROXIMITY_THRESHOLD_KM} km
     * of them. Rate-limited per session so people aren't spammed every broadcast tick.
     */
    public List<ProximityAlert> pendingProximityAlerts() {
        long now = System.currentTimeMillis();
        List<ProximityAlert> alerts = new ArrayList<>();
        for (ClientSession session : sessions.values()) {
            if (session.type != ClientType.USER
                    || session.coords == null
                    || session.trackingBusCode == null
                    || now - session.lastProximityAlert < PROXIMITY_COOLDOWN_MS) {
                continue;
            }
            LiveBusState state = liveBuses.get(session.trackingBusCode);
            if (state == null || !state.isVisible()) {
                continue;
            }
            Optional<TimedPoint> latest = state.latest();
            if (latest.isEmpty()) {
                continue;
            }
            double distance = GeoUtils.distanceKm(
                    session.coords[0], session.coords[1],
                    latest.get().lat(), latest.get().lng());
            if (distance <= PROXIMITY_THRESHOLD_KM) {
                session.lastProximityAlert = now;
                alerts.add(new ProximityAlert(session.sessionId, session.trackingBusCode, distance));
            }
        }
        return alerts;
    }

    /** Evicts sessions with no traffic for {@code timeoutMs}; returns them for goodbye broadcasts. */
    public List<ClientSession> evictStaleSessions(long timeoutMs) {
        long cutoff = System.currentTimeMillis() - timeoutMs;
        List<ClientSession> evicted = new ArrayList<>();
        for (ClientSession session : sessions.values()) {
            if (session.lastSeen < cutoff) {
                removeSession(session.sessionId).ifPresent(evicted::add);
            }
        }
        return evicted;
    }

    private LiveBusDto toDto(LiveBusState state) {
        TimedPoint latest = state.latest().orElse(null);
        return new LiveBusDto(
                state.getBusCode(),
                state.getDriverId(),
                latest == null ? null : new double[]{latest.lat(), latest.lng()},
                state.speedKmh().map(v -> Math.round(v * 10.0) / 10.0).orElse(null),
                state.accuracy,
                state.isVisible(),
                state.getLastSeen(),
                state.occupancy == null ? null : state.occupancy.name(),
                state.routeNumber,
                state.routeColor
        );
    }
}
