package com.citybus.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GeoUtilsTest {

    @Test
    void distanceBetweenIdenticalPointsIsZero() {
        assertThat(GeoUtils.distanceKm(19.8762, 75.3433, 19.8762, 75.3433)).isZero();
    }

    @Test
    void distanceMatchesKnownValue() {
        // Aurangabad Central Bus Station → Railway Station is roughly 3.9 km
        double km = GeoUtils.distanceKm(19.8762, 75.3433, 19.8610, 75.3101);
        assertThat(km).isBetween(3.5, 4.3);
    }

    @Test
    void distanceIsSymmetric() {
        double ab = GeoUtils.distanceKm(19.85, 75.20, 19.90, 75.36);
        double ba = GeoUtils.distanceKm(19.90, 75.36, 19.85, 75.20);
        assertThat(ab).isEqualTo(ba);
    }

    @Test
    void coordinateRangeValidation() {
        assertThat(GeoUtils.isValidLatitude(90.0)).isTrue();
        assertThat(GeoUtils.isValidLatitude(-90.0)).isTrue();
        assertThat(GeoUtils.isValidLatitude(90.1)).isFalse();
        assertThat(GeoUtils.isValidLongitude(180.0)).isTrue();
        assertThat(GeoUtils.isValidLongitude(-180.1)).isFalse();
    }
}
