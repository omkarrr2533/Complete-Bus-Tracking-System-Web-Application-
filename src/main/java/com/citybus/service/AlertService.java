package com.citybus.service;

import com.citybus.domain.Route;
import com.citybus.domain.ServiceAlert;
import com.citybus.dto.AlertRequest;
import com.citybus.dto.AlertResponse;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.RouteRepository;
import com.citybus.repository.ServiceAlertRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Service alerts: delays, diversions, planned works. The public feed is
 * cached briefly (it is polled by every rider client) and filtered to alerts
 * that are active and unexpired.
 */
@Service
public class AlertService {

    private final ServiceAlertRepository alertRepository;
    private final RouteRepository routeRepository;

    public AlertService(ServiceAlertRepository alertRepository, RouteRepository routeRepository) {
        this.alertRepository = alertRepository;
        this.routeRepository = routeRepository;
    }

    /** Rider-facing feed: live alerts only. */
    @Cacheable(value = "alerts", key = "'live'")
    @Transactional(readOnly = true)
    public List<AlertResponse> liveFeed() {
        return alertRepository.findByActiveTrueOrderByCreatedAtDesc().stream()
                .filter(ServiceAlert::isLive)
                .map(AlertResponse::from)
                .toList();
    }

    /** Admin view: everything, newest first. */
    @Transactional(readOnly = true)
    public List<AlertResponse> findAll() {
        return alertRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(AlertResponse::from)
                .toList();
    }

    @CacheEvict(value = "alerts", allEntries = true)
    @Transactional
    public AlertResponse create(AlertRequest request) {
        ServiceAlert alert = new ServiceAlert();
        apply(alert, request);
        return AlertResponse.from(alertRepository.save(alert));
    }

    @CacheEvict(value = "alerts", allEntries = true)
    @Transactional
    public AlertResponse update(Long id, AlertRequest request) {
        ServiceAlert alert = getEntity(id);
        apply(alert, request);
        return AlertResponse.from(alertRepository.save(alert));
    }

    @CacheEvict(value = "alerts", allEntries = true)
    @Transactional
    public void delete(Long id) {
        alertRepository.delete(getEntity(id));
    }

    private ServiceAlert getEntity(Long id) {
        return alertRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Alert", id));
    }

    private void apply(ServiceAlert alert, AlertRequest request) {
        alert.setTitle(request.title().trim());
        alert.setMessage(request.message().trim());
        alert.setSeverity(request.severity());
        alert.setActive(request.active() == null || request.active());
        alert.setExpiresAt(request.expiresAt());
        if (request.routeId() == null) {
            alert.setRoute(null);
        } else {
            Route route = routeRepository.findById(request.routeId())
                    .orElseThrow(() -> new ResourceNotFoundException("Route", request.routeId()));
            alert.setRoute(route);
        }
    }
}
