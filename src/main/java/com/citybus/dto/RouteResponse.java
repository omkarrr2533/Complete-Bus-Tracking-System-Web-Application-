package com.citybus.dto;

import java.time.Instant;
import java.util.List;

public record RouteResponse(
        Long id,
        int routeNumber,
        String name,
        String color,
        String firstBus,
        String lastBus,
        int frequencyMinutes,
        boolean active,
        List<double[]> path,
        List<StopDto> stops,
        long busCount,
        Instant updatedAt
) {
}
