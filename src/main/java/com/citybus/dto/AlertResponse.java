package com.citybus.dto;

import com.citybus.domain.ServiceAlert;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record AlertResponse(
        Long id,
        String title,
        String message,
        ServiceAlert.Severity severity,
        Long routeId,
        Integer routeNumber,
        String routeName,
        String routeColor,
        boolean active,
        boolean live,
        Instant createdAt,
        Instant expiresAt
) {

    public static AlertResponse from(ServiceAlert alert) {
        var route = alert.getRoute();
        return new AlertResponse(
                alert.getId(),
                alert.getTitle(),
                alert.getMessage(),
                alert.getSeverity(),
                route == null ? null : route.getId(),
                route == null ? null : route.getRouteNumber(),
                route == null ? null : route.getName(),
                route == null ? null : route.getColor(),
                alert.isActive(),
                alert.isLive(),
                alert.getCreatedAt(),
                alert.getExpiresAt()
        );
    }
}
