package com.citybus.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record BusResponse(
        Long id,
        String code,
        Long routeId,
        Integer routeNumber,
        String routeName,
        String routeColor,
        boolean active,
        LiveBusDto live,
        Instant updatedAt
) {
}
