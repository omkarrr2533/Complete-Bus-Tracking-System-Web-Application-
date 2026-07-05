package com.citybus.repository;

import com.citybus.domain.Bus;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BusRepository extends JpaRepository<Bus, Long> {

    @EntityGraph(attributePaths = {"route"})
    Optional<Bus> findByCode(String code);

    boolean existsByCode(String code);

    @EntityGraph(attributePaths = {"route"})
    List<Bus> findAllByOrderByCodeAsc();

    long countByRouteId(Long routeId);
}
