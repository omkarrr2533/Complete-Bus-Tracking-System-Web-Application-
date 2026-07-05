package com.citybus.security;

import com.citybus.dto.ApiError;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Fixed-window rate limiter for the login endpoint: at most
 * {@value MAX_ATTEMPTS_PER_WINDOW} attempts per client IP per minute, which
 * blunts credential-stuffing without hurting legitimate users. Windows are
 * kept in memory per instance; behind a load balancer this becomes
 * per-instance, which is an accepted trade-off documented in the design doc
 * (a shared Redis bucket is the horizontal-scale answer).
 */
@Component
public class LoginRateLimitFilter extends OncePerRequestFilter {

    static final int MAX_ATTEMPTS_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000;
    private static final int MAX_TRACKED_CLIENTS = 10_000;

    private static final class Window {
        volatile long startedAt;
        final AtomicInteger count = new AtomicInteger();

        Window(long startedAt) {
            this.startedAt = startedAt;
        }
    }

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;

    public LoginRateLimitFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !("POST".equals(request.getMethod())
                && "/api/v1/auth/login".equals(request.getRequestURI()));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (!tryAcquire(clientIp(request))) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            ApiError body = ApiError.of(HttpStatus.TOO_MANY_REQUESTS.value(), "Too Many Requests",
                    "Too many login attempts. Try again in a minute.", request.getRequestURI());
            objectMapper.writeValue(response.getWriter(), body);
            return;
        }
        filterChain.doFilter(request, response);
    }

    boolean tryAcquire(String clientKey) {
        long now = System.currentTimeMillis();
        if (windows.size() > MAX_TRACKED_CLIENTS) {
            windows.entrySet().removeIf(e -> now - e.getValue().startedAt > WINDOW_MS);
        }
        Window window = windows.compute(clientKey, (key, existing) -> {
            if (existing == null || now - existing.startedAt > WINDOW_MS) {
                return new Window(now);
            }
            return existing;
        });
        return window.count.incrementAndGet() <= MAX_ATTEMPTS_PER_WINDOW;
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
