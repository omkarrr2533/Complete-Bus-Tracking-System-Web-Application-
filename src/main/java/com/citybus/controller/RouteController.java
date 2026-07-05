package com.citybus.controller;

import com.citybus.dto.RouteRequest;
import com.citybus.dto.RouteResponse;
import com.citybus.service.RouteService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.List;

/**
 * Route CRUD. Reads are public (they power the rider map) and served from
 * cache; writes require an ADMIN token — enforced centrally in SecurityConfig.
 */
@RestController
@RequestMapping("/api/v1/routes")
@Tag(name = "Routes", description = "Route network management")
public class RouteController {

    private final RouteService routeService;

    public RouteController(RouteService routeService) {
        this.routeService = routeService;
    }

    @GetMapping
    @Operation(summary = "List all routes with paths and stops")
    public ResponseEntity<List<RouteResponse>> list() {
        return ResponseEntity.ok(routeService.findAll());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get one route by id")
    public ResponseEntity<RouteResponse> get(@PathVariable Long id) {
        return ResponseEntity.ok(routeService.findById(id));
    }

    @PostMapping
    @Operation(summary = "Create a route (admin)")
    public ResponseEntity<RouteResponse> create(@Valid @RequestBody RouteRequest request) {
        RouteResponse created = routeService.create(request);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}").buildAndExpand(created.id()).toUri();
        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Replace a route (admin)")
    public ResponseEntity<RouteResponse> update(@PathVariable Long id,
                                                @Valid @RequestBody RouteRequest request) {
        return ResponseEntity.ok(routeService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a route with no assigned buses (admin)")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        routeService.delete(id);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }
}
