package com.citybus.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.util.Objects;

/**
 * A single WGS-84 coordinate. Embedded into route path polylines
 * (route_path collection table) rather than being an entity of its own.
 */
@Embeddable
public class GeoPoint {

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    protected GeoPoint() {
    }

    public GeoPoint(double lat, double lng) {
        this.lat = lat;
        this.lng = lng;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof GeoPoint other)) return false;
        return Double.compare(lat, other.lat) == 0 && Double.compare(lng, other.lng) == 0;
    }

    @Override
    public int hashCode() {
        return Objects.hash(lat, lng);
    }
}
