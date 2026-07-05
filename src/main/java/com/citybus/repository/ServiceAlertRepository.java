package com.citybus.repository;

import com.citybus.domain.ServiceAlert;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ServiceAlertRepository extends JpaRepository<ServiceAlert, Long> {

    List<ServiceAlert> findAllByOrderByCreatedAtDesc();

    List<ServiceAlert> findByActiveTrueOrderByCreatedAtDesc();

    long countByRouteId(Long routeId);
}
