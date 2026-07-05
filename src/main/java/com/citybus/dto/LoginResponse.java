package com.citybus.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record LoginResponse(
        String accessToken,
        String tokenType,
        long expiresInSeconds,
        String username,
        String displayName,
        String role,
        String busCode
) {
}
