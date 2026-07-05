package com.citybus.service;

import com.citybus.dto.RouteRequest;
import com.citybus.dto.RouteResponse;
import com.citybus.dto.StopDto;
import com.citybus.exception.BadRequestException;
import com.citybus.exception.ConflictException;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.BusRepository;
import com.citybus.repository.RouteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
class RouteServiceTest {

    @Autowired
    private RouteRepository routeRepository;

    @Autowired
    private BusRepository busRepository;

    private RouteService routeService;

    @BeforeEach
    void setUp() {
        routeService = new RouteService(routeRepository, busRepository, event -> { });
    }

    private RouteRequest validRequest(int number) {
        return new RouteRequest(
                number, "Test Route " + number, "#1d4ed8", "06:00", "22:00", 15, true,
                List.of(new double[]{19.85, 75.30}, new double[]{19.86, 75.31}),
                List.of(new StopDto(null, "Stop A", 19.85, 75.30),
                        new StopDto(null, "Stop B", 19.86, 75.31)));
    }

    @Test
    void createPersistsRouteWithPathAndStops() {
        RouteResponse created = routeService.create(validRequest(1));

        assertThat(created.id()).isNotNull();
        assertThat(created.routeNumber()).isEqualTo(1);
        assertThat(created.path()).hasSize(2);
        assertThat(created.stops()).extracting(StopDto::name).containsExactly("Stop A", "Stop B");
        assertThat(routeRepository.count()).isEqualTo(1);
    }

    @Test
    void duplicateRouteNumberIsRejected() {
        routeService.create(validRequest(7));

        assertThatThrownBy(() -> routeService.create(validRequest(7)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("7");
    }

    @Test
    void updateReplacesStopsAndPath() {
        RouteResponse created = routeService.create(validRequest(2));

        RouteRequest changed = new RouteRequest(
                2, "Renamed", "#0f766e", "05:30", "23:00", 20, false,
                List.of(new double[]{19.80, 75.20}, new double[]{19.81, 75.21}, new double[]{19.82, 75.22}),
                List.of(new StopDto(null, "New A", 19.80, 75.20),
                        new StopDto(null, "New B", 19.82, 75.22)));

        RouteResponse updated = routeService.update(created.id(), changed);

        assertThat(updated.name()).isEqualTo("Renamed");
        assertThat(updated.active()).isFalse();
        assertThat(updated.path()).hasSize(3);
        assertThat(updated.stops()).extracting(StopDto::name).containsExactly("New A", "New B");
    }

    @Test
    void updateToTakenRouteNumberIsRejected() {
        routeService.create(validRequest(3));
        RouteResponse other = routeService.create(validRequest(4));

        RouteRequest collides = validRequest(3);
        assertThatThrownBy(() -> routeService.update(other.id(), collides))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void deleteRemovesRoute() {
        RouteResponse created = routeService.create(validRequest(5));

        routeService.delete(created.id());

        assertThat(routeRepository.count()).isZero();
    }

    @Test
    void unknownIdYieldsNotFound() {
        assertThatThrownBy(() -> routeService.findById(999L))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void outOfRangePathPointIsRejected() {
        RouteRequest bad = new RouteRequest(
                6, "Bad", "#1d4ed8", "06:00", "22:00", 15, true,
                List.of(new double[]{99.0, 75.30}, new double[]{19.86, 75.31}),
                List.of(new StopDto(null, "A", 19.85, 75.30),
                        new StopDto(null, "B", 19.86, 75.31)));

        assertThatThrownBy(() -> routeService.create(bad))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("out of range");
    }
}
