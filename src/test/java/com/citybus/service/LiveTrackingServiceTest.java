package com.citybus.service;

import com.citybus.dto.LiveBusDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class LiveTrackingServiceTest {

    private LiveTrackingService tracking;

    @BeforeEach
    void setUp() {
        tracking = new LiveTrackingService();
    }

    @Test
    void driverRegistrationCreatesLiveBus() {
        tracking.registerDriver("session-1", "driver1", "bus-1");
        tracking.updateDriverLocation("session-1", 19.85, 75.30, 10.0, true);

        List<LiveBusDto> live = tracking.snapshotVisibleBuses();
        assertThat(live).hasSize(1);
        assertThat(live.get(0).busId()).isEqualTo("bus-1");
        assertThat(live.get(0).driverId()).isEqualTo("driver1");
        assertThat(live.get(0).coords()).containsExactly(19.85, 75.30);
    }

    @Test
    void locationUpdateFromNonDriverIsIgnored() {
        tracking.registerUser("session-u", "user-1");

        Optional<LiveBusDto> result = tracking.updateDriverLocation("session-u", 19.85, 75.30, null, null);

        assertThat(result).isEmpty();
        assertThat(tracking.snapshotVisibleBuses()).isEmpty();
    }

    @Test
    void invalidCoordinatesAreRejected() {
        tracking.registerDriver("session-1", "driver1", "bus-1");

        Optional<LiveBusDto> result = tracking.updateDriverLocation("session-1", 91.0, 75.30, null, null);

        assertThat(result).isEmpty();
    }

    @Test
    void speedIsComputedFromRecentPings() {
        // Feed synthetic timed points directly into the ring buffer:
        // ~1.11 km of northward travel over 2 minutes ≈ 33 km/h
        LiveTrackingService.LiveBusState state =
                new LiveTrackingService.LiveBusState("bus-1", "driver1");
        long t0 = System.currentTimeMillis();
        state.addPoint(19.8500, 75.3000, t0);
        state.addPoint(19.8550, 75.3000, t0 + 60_000);
        state.addPoint(19.8600, 75.3000, t0 + 120_000);

        Optional<Double> speed = state.speedKmh();

        assertThat(speed).isPresent();
        assertThat(speed.get()).isBetween(30.0, 36.0);
    }

    @Test
    void speedIsEmptyForSinglePing() {
        LiveTrackingService.LiveBusState state =
                new LiveTrackingService.LiveBusState("bus-1", "driver1");
        state.addPoint(19.85, 75.30, System.currentTimeMillis());

        assertThat(state.speedKmh()).isEmpty();
    }

    @Test
    void implausibleGpsJumpIsClamped() {
        LiveTrackingService.LiveBusState state =
                new LiveTrackingService.LiveBusState("bus-1", "driver1");
        long t0 = System.currentTimeMillis();
        state.addPoint(19.85, 75.30, t0);
        state.addPoint(20.85, 75.30, t0 + 10_000); // ~111 km in 10 s

        assertThat(state.speedKmh()).contains(120.0);
    }

    @Test
    void hiddenBusIsExcludedFromSnapshot() {
        tracking.registerDriver("session-1", "driver1", "bus-1");
        tracking.updateDriverLocation("session-1", 19.85, 75.30, null, true);
        tracking.setDriverVisibility("driver1", false);

        assertThat(tracking.snapshotVisibleBuses()).isEmpty();
    }

    @Test
    void proximityAlertFiresWithinThresholdAndCoolsDown() {
        tracking.registerDriver("session-d", "driver1", "bus-1");
        tracking.registerUser("session-u", "user-1");
        tracking.updateUserLocation("session-u", 19.8500, 75.3000);
        tracking.trackBus("session-u", "bus-1");
        // Bus ~200 m from the user
        tracking.updateDriverLocation("session-d", 19.8518, 75.3000, null, true);

        List<LiveTrackingService.ProximityAlert> first = tracking.pendingProximityAlerts();
        List<LiveTrackingService.ProximityAlert> second = tracking.pendingProximityAlerts();

        assertThat(first).hasSize(1);
        assertThat(first.get(0).busCode()).isEqualTo("bus-1");
        assertThat(first.get(0).distanceKm()).isLessThan(0.5);
        assertThat(second).isEmpty(); // cooldown suppresses repeats
    }

    @Test
    void noAlertWhenBusIsFar() {
        tracking.registerDriver("session-d", "driver1", "bus-1");
        tracking.registerUser("session-u", "user-1");
        tracking.updateUserLocation("session-u", 19.8500, 75.3000);
        tracking.trackBus("session-u", "bus-1");
        // Bus ~5.5 km away
        tracking.updateDriverLocation("session-d", 19.9000, 75.3000, null, true);

        assertThat(tracking.pendingProximityAlerts()).isEmpty();
    }

    @Test
    void removingDriverSessionRetiresTheBus() {
        tracking.registerDriver("session-1", "driver1", "bus-1");
        tracking.updateDriverLocation("session-1", 19.85, 75.30, null, true);

        tracking.removeSession("session-1");

        assertThat(tracking.snapshotVisibleBuses()).isEmpty();
        assertThat(tracking.driverSessions()).isEmpty();
    }

    @Test
    void staleSessionsAreEvicted() throws InterruptedException {
        tracking.registerDriver("session-1", "driver1", "bus-1");
        Thread.sleep(30);

        List<LiveTrackingService.ClientSession> evicted = tracking.evictStaleSessions(10);

        assertThat(evicted).hasSize(1);
        assertThat(evicted.get(0).getBusCode()).isEqualTo("bus-1");
        assertThat(tracking.driverSessions()).isEmpty();
    }
}
