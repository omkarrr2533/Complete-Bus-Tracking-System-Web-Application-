package com.citybus.controller;

import com.citybus.dto.AlertRequest;
import com.citybus.dto.AlertResponse;
import com.citybus.service.AlertService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
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

import java.util.List;

@RestController
@RequestMapping("/api/v1/alerts")
@Tag(name = "Service Alerts", description = "Operational notices: delays, diversions, planned works")
public class AlertController {

    private final AlertService alertService;

    public AlertController(AlertService alertService) {
        this.alertService = alertService;
    }

    @GetMapping
    @Operation(summary = "Live alerts feed (public) — active, unexpired notices for riders")
    public List<AlertResponse> liveFeed() {
        return alertService.liveFeed();
    }

    @GetMapping("/all")
    @Operation(summary = "All alerts including inactive/expired (admin)",
            security = @SecurityRequirement(name = "bearerAuth"))
    public List<AlertResponse> findAll() {
        return alertService.findAll();
    }

    @PostMapping
    @Operation(summary = "Publish an alert", security = @SecurityRequirement(name = "bearerAuth"))
    public ResponseEntity<AlertResponse> create(@Valid @RequestBody AlertRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(alertService.create(request));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Replace an alert", security = @SecurityRequirement(name = "bearerAuth"))
    public AlertResponse update(@PathVariable Long id, @Valid @RequestBody AlertRequest request) {
        return alertService.update(id, request);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete an alert", security = @SecurityRequirement(name = "bearerAuth"))
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        alertService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
