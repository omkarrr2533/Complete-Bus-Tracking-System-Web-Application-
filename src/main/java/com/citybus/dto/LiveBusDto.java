package com.citybus.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Snapshot of a bus's live telemetry — sourced from the in-memory tracking
 * registry, never from the database.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LiveBusDto(
        String busId,
        String driverId,
        double[] coords,
        Double speedKmh,
        Double accuracy,
        boolean visible,
        long lastSeen
) {
}
