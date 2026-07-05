package com.citybus.service;

import com.citybus.domain.GeoPoint;
import com.citybus.domain.Route;
import com.citybus.domain.Stop;
import com.citybus.dto.JourneyDto;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.RouteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The test network: two routes that meet mid-city.
 *
 *   Route 1:  A(19.850,75.300) → B(19.860,75.310) → C(19.870,75.320)
 *   Route 2:  X(19.8605,75.3105) → Y(19.880,75.300) → Z(19.890,75.290)
 *
 * B and X are ~120 m apart — a legal walking transfer.
 */
@DataJpaTest
class JourneyPlannerServiceTest {

    @Autowired
    private RouteRepository routeRepository;

    private JourneyPlannerService planner;

    @BeforeEach
    void setUp() {
        routeRepository.deleteAll();
        seedRoute(1, "Eastbound", List.of(
                new Stop("A", 19.850, 75.300),
                new Stop("B", 19.860, 75.310),
                new Stop("C", 19.870, 75.320)));
        seedRoute(2, "Northbound", List.of(
                new Stop("X", 19.8605, 75.3105),
                new Stop("Y", 19.880, 75.300),
                new Stop("Z", 19.890, 75.290)));
        planner = new JourneyPlannerService(routeRepository);
    }

    private Route seedRoute(int number, String name, List<Stop> stops) {
        Route route = new Route();
        route.setRouteNumber(number);
        route.setName(name);
        route.setColor("#1d4ed8");
        route.setFirstBus(LocalTime.of(6, 0));
        route.setLastBus(LocalTime.of(22, 0));
        route.setFrequencyMinutes(10);
        route.setPath(stops.stream().map(s -> new GeoPoint(s.getLat(), s.getLng())).toList());
        route.setStops(stops);
        return routeRepository.save(route);
    }

    @Test
    void directRideOnOneRoute() {
        JourneyDto.Response plan = planner.plan(19.8495, 75.2995, 19.8705, 75.3205);

        assertThat(plan.transfers()).isZero();
        assertThat(plan.legs()).extracting(JourneyDto.Leg::mode)
                .containsExactly("WALK", "RIDE", "WALK");
        JourneyDto.Leg ride = plan.legs().get(1);
        assertThat(ride.routeNumber()).isEqualTo(1);
        assertThat(ride.fromName()).isEqualTo("A");
        assertThat(ride.toName()).isEqualTo("C");
        assertThat(ride.stopCount()).isEqualTo(2);
        assertThat(ride.geometry().size()).isGreaterThanOrEqualTo(2);
        assertThat(plan.totalMinutes()).isGreaterThan(0);
    }

    @Test
    void journeyWithTransferBetweenRoutes() {
        JourneyDto.Response plan = planner.plan(19.8495, 75.2995, 19.8905, 75.2895);

        assertThat(plan.transfers()).isEqualTo(1);
        assertThat(plan.summary()).isEqualTo("Route 1 → Route 2");
        List<String> modes = plan.legs().stream().map(JourneyDto.Leg::mode).toList();
        assertThat(modes).containsExactly("WALK", "RIDE", "WALK", "RIDE", "WALK");
        assertThat(plan.legs().get(1).routeNumber()).isEqualTo(1);
        assertThat(plan.legs().get(3).routeNumber()).isEqualTo(2);
        // The transfer walk is the short B → X hop
        assertThat(plan.legs().get(2).distanceKm()).isLessThan(0.4);
    }

    @Test
    void shortTripsFallBackToWalking() {
        // Far from every stop, 400 m apart → walking is the only sane answer
        JourneyDto.Response plan = planner.plan(19.980, 75.400, 19.9832, 75.4015);

        assertThat(plan.legs()).hasSize(1);
        assertThat(plan.legs().get(0).mode()).isEqualTo("WALK");
        assertThat(plan.transfers()).isZero();
    }

    @Test
    void walkingWinsWhenFasterThanTheBus() {
        // Origin and destination sit near stops A and B (~1.5 km apart):
        // bus wait (5 min) + ride ≈ walk time, but for a very short hop
        // along the corridor walking is competitive; the planner must pick
        // whichever is objectively faster, never force a ride.
        JourneyDto.Response plan = planner.plan(19.850, 75.300, 19.8525, 75.3025);

        assertThat(plan.legs().get(0).mode()).isEqualTo("WALK");
        assertThat(plan.legs()).hasSize(1);
    }

    @Test
    void unreachableJourneyIs404() {
        assertThatThrownBy(() -> planner.plan(20.500, 76.000, 20.600, 76.100))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("No journey found");
    }

    @Test
    void graphRebuildsAfterRouteChange() {
        // Initially unreachable — no route serves the north-east quarter
        assertThatThrownBy(() -> planner.plan(19.8495, 75.2995, 19.950, 75.360))
                .isInstanceOf(ResourceNotFoundException.class);

        // Admin adds a connecting route (transfer at C), planner is notified
        seedRoute(3, "Express NE", List.of(
                new Stop("C2", 19.8702, 75.3202),
                new Stop("NE", 19.949, 75.359)));
        planner.onRoutesChanged();

        JourneyDto.Response plan = planner.plan(19.8495, 75.2995, 19.950, 75.360);
        assertThat(plan.summary()).contains("Route 3");
    }

    @Test
    void inactiveRoutesAreExcludedFromTheGraph() {
        routeRepository.findAll().forEach(r -> {
            r.setActive(false);
            routeRepository.save(r);
        });
        planner.onRoutesChanged();

        assertThatThrownBy(() -> planner.plan(19.8495, 75.2995, 19.8905, 75.2895))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
