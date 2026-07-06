package com.citybus.controller;

import com.citybus.dto.JourneyDto;
import com.citybus.service.JourneyPlannerService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/journeys")
@Tag(name = "Journey Planner", description = "Door-to-door trip planning over the bus network")
public class JourneyController {

    private final JourneyPlannerService planner;

    public JourneyController(JourneyPlannerService planner) {
        this.planner = planner;
    }

    @GetMapping
    @Operation(summary = "Plan the fastest door-to-door journey",
            description = "Dijkstra over the stop graph: walking access/egress, rides along route "
                    + "geometry, and walking transfers between nearby stops of different routes. "
                    + "Returns drawable legs; falls back to a walk-only plan when that is faster.")
    public JourneyDto.Response plan(@RequestParam double fromLat,
                                    @RequestParam double fromLng,
                                    @RequestParam double toLat,
                                    @RequestParam double toLng) {
        return planner.plan(fromLat, fromLng, toLat, toLng);
    }
}
