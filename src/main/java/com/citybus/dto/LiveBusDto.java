package com.citybus.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Snapshot of a bus's live telemetry — sourced from the in-memory tracking
 * registry, never from the database. Route identity is resolved once at
 * driver registration so riders can color and filter buses without joins.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LiveBusDto(
        String busId,
        String driverId,
        double[] coords,
        Double speedKmh,
        Double accuracy,
        boolean visible,
        long lastSeen,
        String occupancy,      // LOW | MEDIUM | FULL, null until reported
        Integer routeNumber,
        String routeColor
) {
}
