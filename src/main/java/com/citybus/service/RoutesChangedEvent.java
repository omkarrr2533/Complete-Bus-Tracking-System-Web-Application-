package com.citybus.service;

/**
 * Published whenever the route network is mutated, so derived structures
 * (journey-planner graph) can invalidate themselves without RouteService
 * knowing they exist.
 */
public record RoutesChangedEvent() {
}
