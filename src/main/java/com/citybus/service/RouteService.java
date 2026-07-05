package com.citybus.service;

import com.citybus.domain.GeoPoint;
import com.citybus.domain.Route;
import com.citybus.domain.Stop;
import com.citybus.dto.RouteRequest;
import com.citybus.dto.RouteResponse;
import com.citybus.dto.StopDto;
import com.citybus.exception.BadRequestException;
import com.citybus.exception.ConflictException;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.BusRepository;
import com.citybus.repository.RouteRepository;
import com.citybus.util.GeoUtils;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * CRUD for routes. Reads are served from the "routes" cache (routes change
 * rarely but are fetched by every map client); any write evicts the whole
 * cache — simple and correct at this cardinality (tens of routes).
 */
@Service
public class RouteService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final RouteRepository routeRepository;
    private final BusRepository busRepository;

    public RouteService(RouteRepository routeRepository, BusRepository busRepository) {
        this.routeRepository = routeRepository;
        this.busRepository = busRepository;
    }

    @Cacheable(value = "routes", key = "'all'")
    @Transactional(readOnly = true)
    public List<RouteResponse> findAll() {
        return routeRepository.findAllByOrderByRouteNumberAsc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Cacheable(value = "routes", key = "#id")
    @Transactional(readOnly = true)
    public RouteResponse findById(Long id) {
        return toResponse(getEntity(id));
    }

    @CacheEvict(value = "routes", allEntries = true)
    @Transactional
    public RouteResponse create(RouteRequest request) {
        if (routeRepository.existsByRouteNumber(request.routeNumber())) {
            throw new ConflictException("Route number " + request.routeNumber() + " already exists");
        }
        Route route = new Route();
        applyRequest(route, request);
        return toResponse(routeRepository.save(route));
    }

    @CacheEvict(value = "routes", allEntries = true)
    @Transactional
    public RouteResponse update(Long id, RouteRequest request) {
        Route route = getEntity(id);
        routeRepository.findByRouteNumber(request.routeNumber())
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new ConflictException("Route number " + request.routeNumber() + " already exists");
                });
        applyRequest(route, request);
        return toResponse(routeRepository.save(route));
    }

    @CacheEvict(value = "routes", allEntries = true)
    @Transactional
    public void delete(Long id) {
        Route route = getEntity(id);
        long assignedBuses = busRepository.countByRouteId(id);
        if (assignedBuses > 0) {
            throw new ConflictException("Cannot delete route " + route.getRouteNumber()
                    + ": " + assignedBuses + " bus(es) are still assigned to it");
        }
        routeRepository.delete(route);
    }

    Route getEntity(Long id) {
        return routeRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Route", id));
    }

    private void applyRequest(Route route, RouteRequest request) {
        validatePath(request.path());
        route.setRouteNumber(request.routeNumber());
        route.setName(request.name().trim());
        route.setColor(request.color().toLowerCase());
        route.setFirstBus(LocalTime.parse(request.firstBus()));
        route.setLastBus(LocalTime.parse(request.lastBus()));
        route.setFrequencyMinutes(request.frequencyMinutes());
        route.setActive(request.active() == null || request.active());
        route.setPath(request.path().stream()
                .map(p -> new GeoPoint(p[0], p[1]))
                .toList());
        route.setStops(request.stops().stream()
                .map(s -> new Stop(s.name().trim(), s.lat(), s.lng()))
                .toList());
    }

    private void validatePath(List<double[]> path) {
        for (double[] point : path) {
            if (point == null || point.length != 2) {
                throw new BadRequestException("Each path point must be a [lat, lng] pair");
            }
            if (!GeoUtils.isValidLatitude(point[0]) || !GeoUtils.isValidLongitude(point[1])) {
                throw new BadRequestException("Path point out of range: ["
                        + point[0] + ", " + point[1] + "]");
            }
        }
    }

    RouteResponse toResponse(Route route) {
        return new RouteResponse(
                route.getId(),
                route.getRouteNumber(),
                route.getName(),
                route.getColor(),
                route.getFirstBus().format(HH_MM),
                route.getLastBus().format(HH_MM),
                route.getFrequencyMinutes(),
                route.isActive(),
                route.getPath().stream().map(p -> new double[]{p.getLat(), p.getLng()}).toList(),
                route.getStops().stream()
                        .map(s -> new StopDto(s.getId(), s.getName(), s.getLat(), s.getLng()))
                        .toList(),
                busRepository.countByRouteId(route.getId()),
                route.getUpdatedAt()
        );
    }
}
