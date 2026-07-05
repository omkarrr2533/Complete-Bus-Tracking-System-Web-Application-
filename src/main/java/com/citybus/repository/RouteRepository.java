package com.citybus.repository;

import com.citybus.domain.Route;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RouteRepository extends JpaRepository<Route, Long> {

    Optional<Route> findByRouteNumber(int routeNumber);

    boolean existsByRouteNumber(int routeNumber);

    /** Fetches stops eagerly to avoid N+1 when mapping the full list. */
    @EntityGraph(attributePaths = {"stops"})
    List<Route> findAllByOrderByRouteNumberAsc();
}
