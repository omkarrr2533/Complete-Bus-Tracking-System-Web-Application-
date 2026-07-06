package com.citybus.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

/** Admin payload for creating or replacing a service alert. */
public record AlertRequest(
        @NotBlank(message = "Title is required")
        @Size(max = 120, message = "Title must be at most 120 characters")
        String title,

        @NotBlank(message = "Message is required")
        @Size(max = 500, message = "Message must be at most 500 characters")
        String message,

        @NotNull(message = "Severity is required (INFO, WARNING or CRITICAL)")
        com.citybus.domain.ServiceAlert.Severity severity,

        /** Null = network-wide alert. */
        Long routeId,

        Boolean active,

        /** Null = no automatic expiry. */
        Instant expiresAt
) {
}
