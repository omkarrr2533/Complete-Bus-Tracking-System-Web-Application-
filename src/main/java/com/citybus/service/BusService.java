package com.citybus.service;

import com.citybus.domain.Bus;
import com.citybus.domain.Route;
import com.citybus.dto.BusRequest;
import com.citybus.dto.BusResponse;
import com.citybus.dto.PageResponse;
import com.citybus.exception.ConflictException;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.BusRepository;
import com.citybus.repository.RouteRepository;
import com.citybus.repository.UserRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Fleet CRUD. Responses are enriched with live telemetry from
 * {@link LiveTrackingService} so one call answers both "what buses exist"
 * and "which of them are on the road right now".
 */
@Service
public class BusService {

    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final UserRepository userRepository;
    private final LiveTrackingService liveTrackingService;

    public BusService(BusRepository busRepository,
                      RouteRepository routeRepository,
                      UserRepository userRepository,
                      LiveTrackingService liveTrackingService) {
        this.busRepository = busRepository;
        this.routeRepository = routeRepository;
        this.userRepository = userRepository;
        this.liveTrackingService = liveTrackingService;
    }

    @Transactional(readOnly = true)
    public PageResponse<BusResponse> page(Pageable pageable) {
        return PageResponse.from(busRepository.findAll(pageable).map(this::toResponse));
    }

    @Transactional(readOnly = true)
    public List<BusResponse> findAll() {
        return busRepository.findAllByOrderByCodeAsc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public BusResponse findById(Long id) {
        return toResponse(getEntity(id));
    }

    @Transactional(readOnly = true)
    public BusResponse findByCode(String code) {
        return busRepository.findByCode(code)
                .map(this::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("Bus", code));
    }

    @Transactional
    public BusResponse create(BusRequest request) {
        if (busRepository.existsByCode(request.code())) {
            throw new ConflictException("Bus code '" + request.code() + "' already exists");
        }
        Bus bus = new Bus(request.code(), getRoute(request.routeId()));
        bus.setActive(request.active() == null || request.active());
        return toResponse(busRepository.save(bus));
    }

    @Transactional
    public BusResponse update(Long id, BusRequest request) {
        Bus bus = getEntity(id);
        busRepository.findByCode(request.code())
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new ConflictException("Bus code '" + request.code() + "' already exists");
                });
        bus.setCode(request.code());
        bus.setRoute(getRoute(request.routeId()));
        if (request.active() != null) {
            bus.setActive(request.active());
        }
        return toResponse(busRepository.save(bus));
    }

    @Transactional
    public void delete(Long id) {
        Bus bus = getEntity(id);
        if (userRepository.existsByBusId(id)) {
            throw new ConflictException("Cannot delete bus '" + bus.getCode()
                    + "': a driver account is still assigned to it");
        }
        busRepository.delete(bus);
    }

    private Bus getEntity(Long id) {
        return busRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Bus", id));
    }

    private Route getRoute(Long routeId) {
        return routeRepository.findById(routeId)
                .orElseThrow(() -> new ResourceNotFoundException("Route", routeId));
    }

    private BusResponse toResponse(Bus bus) {
        Route route = bus.getRoute();
        return new BusResponse(
                bus.getId(),
                bus.getCode(),
                route == null ? null : route.getId(),
                route == null ? null : route.getRouteNumber(),
                route == null ? null : route.getName(),
                route == null ? null : route.getColor(),
                bus.isActive(),
                liveTrackingService.liveBus(bus.getCode()).orElse(null),
                bus.getUpdatedAt()
        );
    }
}
