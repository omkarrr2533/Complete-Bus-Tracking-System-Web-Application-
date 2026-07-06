package com.citybus.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** A door-to-door journey plan: walk / ride / transfer legs. */
public final class JourneyDto {

    private JourneyDto() {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Leg(
            String mode,              // WALK | RIDE
            String fromName,
            String toName,
            Integer routeNumber,      // RIDE only
            String routeName,         // RIDE only
            String routeColor,        // RIDE only
            Integer stopCount,        // RIDE only: stops travelled
            Double waitMinutes,       // RIDE only: expected wait before boarding
            double distanceKm,
            double durationMinutes,
            List<double[]> geometry   // polyline to draw for this leg
    ) {
    }

    public record Response(
            double totalMinutes,
            double totalKm,
            int transfers,
            String summary,
            List<Leg> legs
    ) {
    }
}
