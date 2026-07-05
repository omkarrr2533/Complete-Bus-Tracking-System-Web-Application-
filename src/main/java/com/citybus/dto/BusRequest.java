package com.citybus.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record BusRequest(
        @NotBlank(message = "Bus code is required")
        @Pattern(regexp = "^[a-z0-9][a-z0-9-]{1,31}$",
                message = "Bus code must be 2-32 lowercase letters, digits or hyphens")
        String code,

        @NotNull(message = "Route id is required")
        Long routeId,

        Boolean active
) {
}
