package com.citybus.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Create/update payload for a route. Path points are [lat, lng] pairs;
 * coordinate ranges are validated in the service layer.
 */
public record RouteRequest(
        @Min(value = 1, message = "Route number must be positive")
        @Max(value = 999, message = "Route number must be at most 999")
        int routeNumber,

        @NotBlank(message = "Route name is required")
        @Size(max = 100, message = "Route name must be at most 100 characters")
        String name,

        @NotBlank(message = "Color is required")
        @Pattern(regexp = "^#[0-9a-fA-F]{6}$", message = "Color must be a hex value like #1d4ed8")
        String color,

        @NotBlank(message = "First bus time is required")
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "First bus must be HH:mm")
        String firstBus,

        @NotBlank(message = "Last bus time is required")
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Last bus must be HH:mm")
        String lastBus,

        @Min(value = 1, message = "Frequency must be at least 1 minute")
        @Max(value = 240, message = "Frequency must be at most 240 minutes")
        int frequencyMinutes,

        Boolean active,

        @NotNull(message = "Path is required")
        @Size(min = 2, message = "Path needs at least 2 points")
        List<double[]> path,

        @NotNull(message = "Stops are required")
        @Size(min = 2, message = "A route needs at least 2 stops")
        List<@Valid StopDto> stops
) {
}
