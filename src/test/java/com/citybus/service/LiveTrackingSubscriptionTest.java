package com.citybus.service;

import com.citybus.dto.LiveBusDto;
import com.citybus.service.LiveTrackingService.ClientSession;
import com.citybus.service.LiveTrackingService.Occupancy;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class LiveTrackingSubscriptionTest {

    private LiveTrackingService tracking;

    @BeforeEach
    void setUp() {
        tracking = new LiveTrackingService();
    }

    @Test
    void driverRegistrationCarriesRouteIdentity() {
        tracking.registerDriver("s-d", "driver1", "bus-1", 7, "#7c3aed");
        tracking.updateDriverLocation("s-d", 19.85, 75.30, null, true);

        LiveBusDto dto = tracking.snapshotVisibleBuses().get(0);
        assertThat(dto.routeNumber()).isEqualTo(7);
        assertThat(dto.routeColor()).isEqualTo("#7c3aed");
    }

    @Test
    void occupancyReportRoundTrips() {
        tracking.registerDriver("s-d", "driver1", "bus-1", 1, "#1d4ed8");
        tracking.updateDriverLocation("s-d", 19.85, 75.30, null, true);

        Optional<LiveBusDto> dto = tracking.setOccupancy("s-d", Occupancy.FULL);

        assertThat(dto).isPresent();
        assertThat(dto.get().occupancy()).isEqualTo("FULL");
        assertThat(tracking.snapshotVisibleBuses().get(0).occupancy()).isEqualTo("FULL");
    }

    @Test
    void occupancyFromRiderSessionIsRejected() {
        tracking.registerUser("s-u", "user-1");

        assertThat(tracking.setOccupancy("s-u", Occupancy.LOW)).isEmpty();
    }

    @Test
    void routeSubscriptionFiltersFanOut() {
        tracking.registerUser("s-u", "user-1");
        tracking.subscribeRoute("s-u", 2);

        ClientSession rider = tracking.userSessions().get(0);
        assertThat(rider.wantsRoute(2)).isTrue();
        assertThat(rider.wantsRoute(1)).isFalse();
        // Buses with unknown route still reach everyone (fail open, not silent)
        assertThat(rider.wantsRoute(null)).isTrue();

        tracking.subscribeRoute("s-u", null); // back to the whole network
        assertThat(rider.wantsRoute(1)).isTrue();
    }

    @Test
    void subscriptionFromDriverSessionIsIgnored() {
        tracking.registerDriver("s-d", "driver1", "bus-1", 1, "#1d4ed8");
        tracking.subscribeRoute("s-d", 3);

        assertThat(tracking.driverSessions().get(0).getSubscribedRouteNumber()).isNull();
    }
}
