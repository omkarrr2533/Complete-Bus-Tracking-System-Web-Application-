package com.citybus.websocket;

import com.citybus.domain.Bus;
import com.citybus.domain.Route;
import com.citybus.dto.LiveBusDto;
import com.citybus.repository.BusRepository;
import com.citybus.security.JwtService;
import com.citybus.service.LiveTrackingService;
import com.citybus.service.LiveTrackingService.ClientSession;
import com.citybus.service.LiveTrackingService.ClientType;
import com.citybus.service.LiveTrackingService.Occupancy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Transport layer only: parses messages, authenticates drivers, and routes
 * everything stateful to {@link LiveTrackingService}. Sessions are wrapped in
 * {@link ConcurrentWebSocketSessionDecorator} because broadcasts (scheduler
 * thread) and acknowledgements (I/O thread) may write concurrently, which the
 * raw session forbids.
 *
 * Protocol (JSON, {"type": ..., "data": ...}):
 *   in:  driver-register{token}, driver-location, driver-occupancy,
 *        user-register, user-location, get-active-buses, get-other-drivers,
 *        driver-visibility, track-bus, subscribe-route, ping
 *   out: connection-established, driver-registered, user-registered,
 *        active-buses, bus-location-update, bus-occupancy-update,
 *        location-acknowledged, other-drivers, tracking-started,
 *        route-subscribed, driver-left, proximity-alert, pong, error
 *
 * Fan-out is route-aware: riders may subscribe to a single route
 * (subscribe-route) and then only receive per-ping updates for buses on that
 * route — at high rider counts this cuts broadcast volume roughly by the
 * number of routes. Full snapshots (active-buses) still go to everyone every
 * 10 s so overview maps stay complete.
 */
@Component
public class BusTrackingWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(BusTrackingWebSocketHandler.class);

    private static final long SEND_TIME_LIMIT_MS = 2_000;
    private static final int SEND_BUFFER_LIMIT_BYTES = 128 * 1024;
    private static final long STALE_SESSION_TIMEOUT_MS = 2 * 60 * 1000;

    private final LiveTrackingService tracking;
    private final JwtService jwtService;
    private final ObjectMapper objectMapper;
    private final BusRepository busRepository;

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    private final Counter messagesIn;
    private final Counter messagesOut;
    private final Counter locationPings;

    public BusTrackingWebSocketHandler(LiveTrackingService tracking,
                                       JwtService jwtService,
                                       ObjectMapper objectMapper,
                                       BusRepository busRepository,
                                       MeterRegistry meterRegistry) {
        this.tracking = tracking;
        this.jwtService = jwtService;
        this.objectMapper = objectMapper;
        this.busRepository = busRepository;

        this.messagesIn = Counter.builder("citybus.ws.messages")
                .tag("direction", "in").register(meterRegistry);
        this.messagesOut = Counter.builder("citybus.ws.messages")
                .tag("direction", "out").register(meterRegistry);
        this.locationPings = Counter.builder("citybus.ws.location.pings")
                .register(meterRegistry);
        Gauge.builder("citybus.ws.riders", tracking, t -> t.userSessions().size())
                .description("Connected rider sessions").register(meterRegistry);
        Gauge.builder("citybus.ws.drivers", tracking, t -> t.driverSessions().size())
                .description("Connected driver sessions").register(meterRegistry);
        Gauge.builder("citybus.live.buses", tracking, t -> t.snapshotVisibleBuses().size())
                .description("Buses broadcasting a position").register(meterRegistry);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), new ConcurrentWebSocketSessionDecorator(
                session, (int) SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT_BYTES,
                ConcurrentWebSocketSessionDecorator.OverflowStrategy.DROP));
        send(session.getId(), "connection-established", Map.of(
                "sessionId", session.getId(),
                "timestamp", System.currentTimeMillis()));
    }

    @Override
    public void handleMessage(WebSocketSession rawSession, WebSocketMessage<?> message) {
        String sessionId = rawSession.getId();
        messagesIn.increment();
        try {
            JsonNode root = objectMapper.readTree(message.getPayload().toString());
            String type = root.path("type").asText("unknown");
            JsonNode data = root.path("data");

            switch (type) {
                case "driver-register" -> handleDriverRegister(sessionId, data);
                case "driver-location" -> handleDriverLocation(sessionId, data);
                case "driver-occupancy" -> handleDriverOccupancy(sessionId, data);
                case "user-register" -> handleUserRegister(sessionId, data);
                case "user-location" -> handleUserLocation(sessionId, data);
                case "get-active-buses" -> send(sessionId, "active-buses", tracking.snapshotVisibleBuses());
                case "get-other-drivers" -> handleGetOtherDrivers(sessionId);
                case "driver-visibility" -> handleDriverVisibility(sessionId, data);
                case "track-bus" -> handleTrackBus(sessionId, data);
                case "subscribe-route" -> handleSubscribeRoute(sessionId, data);
                case "ping" -> handlePing(sessionId);
                default -> sendError(sessionId, "Unknown message type: " + type);
            }
        } catch (Exception e) {
            log.warn("Failed to handle WebSocket message from {}: {}", sessionId, e.getMessage());
            sendError(sessionId, "Could not process message");
        }
    }

    /**
     * Drivers must present the JWT they received at login. The bus they
     * broadcast for is taken from the token, never from the payload, so a
     * driver cannot impersonate another vehicle.
     */
    private void handleDriverRegister(String sessionId, JsonNode data) {
        String token = data.path("token").asText(null);
        Optional<Claims> claims = token == null ? Optional.empty() : jwtService.parse(token);

        if (claims.isEmpty() || !"DRIVER".equals(claims.get().get(JwtService.CLAIM_ROLE, String.class))) {
            sendError(sessionId, "Driver authentication failed. Log in again.");
            return;
        }
        String busCode = claims.get().get(JwtService.CLAIM_BUS, String.class);
        if (busCode == null) {
            sendError(sessionId, "No bus is assigned to this driver account.");
            return;
        }
        String driverId = claims.get().getSubject();
        // Resolve route identity once at registration so every subsequent
        // broadcast can carry route number/color without touching the DB.
        Route route = busRepository.findByCode(busCode).map(Bus::getRoute).orElse(null);
        tracking.registerDriver(sessionId, driverId, busCode,
                route == null ? null : route.getRouteNumber(),
                route == null ? null : route.getColor());
        log.info("Driver {} registered for {} (route {})", driverId, busCode,
                route == null ? "unassigned" : route.getRouteNumber());

        send(sessionId, "driver-registered", Map.of(
                "driverId", driverId,
                "busId", busCode,
                "status", "success"));
        broadcastToUsers("new-driver-available", Map.of(
                "driverId", driverId,
                "busId", busCode,
                "timestamp", System.currentTimeMillis()));
    }

    private void handleDriverLocation(String sessionId, JsonNode data) {
        JsonNode coords = data.path("coords");
        if (!coords.isArray() || coords.size() < 2) {
            return;
        }
        Optional<LiveBusDto> updated = tracking.updateDriverLocation(
                sessionId,
                coords.get(0).asDouble(),
                coords.get(1).asDouble(),
                data.hasNonNull("accuracy") ? data.get("accuracy").asDouble() : null,
                data.hasNonNull("visible") ? data.get("visible").asBoolean() : null);

        updated.ifPresent(dto -> {
            locationPings.increment();
            send(sessionId, "location-acknowledged", Map.of(
                    "busId", dto.busId(),
                    "timestamp", System.currentTimeMillis()));
            if (dto.visible()) {
                broadcastToSubscribedUsers("bus-location-update", dto);
                broadcastToOtherDrivers("driver-location-update", dto, sessionId);
            }
        });
        if (updated.isEmpty()) {
            sendError(sessionId, "Register as a driver before sending locations");
        }
    }

    private void handleDriverOccupancy(String sessionId, JsonNode data) {
        Occupancy level;
        try {
            level = Occupancy.valueOf(data.path("level").asText("").toUpperCase());
        } catch (IllegalArgumentException e) {
            sendError(sessionId, "Occupancy level must be LOW, MEDIUM or FULL");
            return;
        }
        tracking.setOccupancy(sessionId, level).ifPresentOrElse(dto -> {
            send(sessionId, "occupancy-acknowledged", Map.of("level", level.name()));
            if (dto.visible()) {
                broadcastToSubscribedUsers("bus-occupancy-update", dto);
            }
        }, () -> sendError(sessionId, "Register as a driver before reporting occupancy"));
    }

    private void handleSubscribeRoute(String sessionId, JsonNode data) {
        Integer routeNumber = data.hasNonNull("routeNumber")
                ? data.get("routeNumber").asInt()
                : null;
        tracking.subscribeRoute(sessionId, routeNumber);
        send(sessionId, "route-subscribed", Map.of(
                "routeNumber", routeNumber == null ? "all" : routeNumber));
    }

    private void handleUserRegister(String sessionId, JsonNode data) {
        String userId = data.path("userId").asText("").isBlank()
                ? "user-" + UUID.randomUUID().toString().substring(0, 8)
                : data.get("userId").asText();
        tracking.registerUser(sessionId, userId);
        send(sessionId, "user-registered", Map.of("userId", userId, "status", "success"));
        send(sessionId, "active-buses", tracking.snapshotVisibleBuses());
    }

    private void handleUserLocation(String sessionId, JsonNode data) {
        JsonNode coords = data.path("coords");
        if (coords.isArray() && coords.size() >= 2) {
            tracking.updateUserLocation(sessionId, coords.get(0).asDouble(), coords.get(1).asDouble());
        }
    }

    private void handleGetOtherDrivers(String sessionId) {
        List<LiveBusDto> others = tracking.snapshotVisibleBuses().stream()
                .filter(dto -> tracking.getSession(sessionId)
                        .map(s -> !dto.busId().equals(s.getBusCode()))
                        .orElse(true))
                .toList();
        send(sessionId, "other-drivers", others);
    }

    private void handleDriverVisibility(String sessionId, JsonNode data) {
        tracking.getSession(sessionId)
                .filter(s -> s.getType() == ClientType.DRIVER)
                .ifPresent(s -> tracking.setDriverVisibility(
                        s.getClientId(), data.path("visible").asBoolean(true)));
    }

    private void handleTrackBus(String sessionId, JsonNode data) {
        String busCode = data.path("busId").asText(null);
        if (busCode != null) {
            tracking.trackBus(sessionId, busCode);
            send(sessionId, "tracking-started", Map.of("busId", busCode, "status", "success"));
        }
    }

    private void handlePing(String sessionId) {
        tracking.touch(sessionId);
        send(sessionId, "pong", Map.of("timestamp", System.currentTimeMillis()));
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("WebSocket transport error for {}: {}", session.getId(), exception.getMessage());
        cleanup(session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) {
        cleanup(session.getId());
    }

    private void cleanup(String sessionId) {
        sessions.remove(sessionId);
        tracking.removeSession(sessionId).ifPresent(this::announceDeparture);
    }

    private void announceDeparture(ClientSession client) {
        if (client.getType() == ClientType.DRIVER) {
            log.info("Driver {} disconnected (bus {})", client.getClientId(), client.getBusCode());
            broadcastToUsers("driver-left", Map.of(
                    "driverId", client.getClientId(),
                    "busId", client.getBusCode()));
        }
    }

    // ── Scheduled maintenance ──────────────────────────────────────────

    /** Push a fresh fleet snapshot and any due proximity alerts every 10s. */
    @Scheduled(fixedRate = 10_000)
    public void broadcastActiveBuses() {
        List<ClientSession> users = tracking.userSessions();
        if (users.isEmpty()) {
            return;
        }
        List<LiveBusDto> snapshot = tracking.snapshotVisibleBuses();
        if (!snapshot.isEmpty()) {
            for (ClientSession user : users) {
                send(user.getSessionId(), "active-buses", snapshot);
            }
        }
        for (LiveTrackingService.ProximityAlert alert : tracking.pendingProximityAlerts()) {
            send(alert.sessionId(), "proximity-alert", Map.of(
                    "busId", alert.busCode(),
                    "distanceKm", Math.round(alert.distanceKm() * 100.0) / 100.0,
                    "message", String.format("Your bus %s is %.0f m away!",
                            alert.busCode(), alert.distanceKm() * 1000)));
        }
    }

    @Scheduled(fixedRate = 30_000)
    public void evictStaleSessions() {
        for (ClientSession stale : tracking.evictStaleSessions(STALE_SESSION_TIMEOUT_MS)) {
            WebSocketSession session = sessions.remove(stale.getSessionId());
            announceDeparture(stale);
            if (session != null && session.isOpen()) {
                try {
                    session.close(CloseStatus.SESSION_NOT_RELIABLE);
                } catch (IOException ignored) {
                    // already gone
                }
            }
        }
    }

    // ── Delivery ───────────────────────────────────────────────────────

    private void broadcastToUsers(String type, Object data) {
        for (ClientSession user : tracking.userSessions()) {
            send(user.getSessionId(), type, data);
        }
    }

    /** Route-aware fan-out: only riders watching this bus's route get the ping. */
    private void broadcastToSubscribedUsers(String type, LiveBusDto dto) {
        for (ClientSession user : tracking.userSessions()) {
            if (user.wantsRoute(dto.routeNumber())) {
                send(user.getSessionId(), type, dto);
            }
        }
    }

    private void broadcastToOtherDrivers(String type, Object data, String excludeSessionId) {
        for (ClientSession driver : tracking.driverSessions()) {
            if (!driver.getSessionId().equals(excludeSessionId)) {
                send(driver.getSessionId(), type, data);
            }
        }
    }

    private void send(String sessionId, String type, Object data) {
        WebSocketSession session = sessions.get(sessionId);
        if (session == null || !session.isOpen()) {
            return;
        }
        try {
            String payload = objectMapper.writeValueAsString(Map.of("type", type, "data", data));
            session.sendMessage(new TextMessage(payload));
            messagesOut.increment();
        } catch (IOException e) {
            log.warn("Failed to send '{}' to {}: {}", type, sessionId, e.getMessage());
        }
    }

    private void sendError(String sessionId, String message) {
        send(sessionId, "error", Map.of("message", message));
    }
}
