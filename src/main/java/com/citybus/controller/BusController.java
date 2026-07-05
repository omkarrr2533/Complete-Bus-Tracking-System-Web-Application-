package com.citybus.controller;

import com.citybus.dto.BusRequest;
import com.citybus.dto.BusResponse;
import com.citybus.dto.LiveBusDto;
import com.citybus.dto.PageResponse;
import com.citybus.service.BusService;
import com.citybus.service.LiveTrackingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * Fleet CRUD plus live telemetry views. The /live and /history endpoints
 * read the in-memory tracking registry, so they answer in microseconds and
 * put zero load on the database.
 */
@RestController
@RequestMapping("/api/v1/buses")
@Tag(name = "Buses", description = "Fleet management and live positions")
public class BusController {

    private static final int MAX_PAGE_SIZE = 100;

    private final BusService busService;
    private final LiveTrackingService liveTrackingService;

    public BusController(BusService busService, LiveTrackingService liveTrackingService) {
        this.busService = busService;
        this.liveTrackingService = liveTrackingService;
    }

    @GetMapping
    @Operation(summary = "List buses (paginated) with live telemetry merged in")
    public ResponseEntity<PageResponse<BusResponse>> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pageable = PageRequest.of(
                Math.max(0, page),
                Math.min(Math.max(1, size), MAX_PAGE_SIZE),
                Sort.by("code"));
        return ResponseEntity.ok(busService.page(pageable));
    }

    @GetMapping("/live")
    @Operation(summary = "Snapshot of buses currently broadcasting a position")
    public ResponseEntity<List<LiveBusDto>> live() {
        return ResponseEntity.ok(liveTrackingService.snapshotVisibleBuses());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get one bus by id")
    public ResponseEntity<BusResponse> get(@PathVariable Long id) {
        return ResponseEntity.ok(busService.findById(id));
    }

    @GetMapping("/code/{code}/history")
    @Operation(summary = "Recent GPS trace for a bus (bounded in-memory window)")
    public ResponseEntity<List<Map<String, Object>>> history(@PathVariable String code) {
        List<Map<String, Object>> trace = liveTrackingService.history(code).stream()
                .map(p -> Map.<String, Object>of(
                        "coords", new double[]{p.lat(), p.lng()},
                        "timestamp", p.timestamp()))
                .toList();
        return ResponseEntity.ok(trace);
    }

    @PostMapping
    @Operation(summary = "Register a bus (admin)")
    public ResponseEntity<BusResponse> create(@Valid @RequestBody BusRequest request) {
        BusResponse created = busService.create(request);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}").buildAndExpand(created.id()).toUri();
        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a bus (admin)")
    public ResponseEntity<BusResponse> update(@PathVariable Long id,
                                              @Valid @RequestBody BusRequest request) {
        return ResponseEntity.ok(busService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Remove a bus with no assigned driver (admin)")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        busService.delete(id);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }
}
