package com.citybus.util;

/**
 * Great-circle math shared by ETA calculation and proximity alerts.
 */
public final class GeoUtils {

    private static final double EARTH_RADIUS_KM = 6371.0;

    private GeoUtils() {
    }

    /** Haversine distance between two WGS-84 coordinates, in kilometres. */
    public static double distanceKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS_KM * c;
    }

    public static boolean isValidLatitude(double lat) {
        return lat >= -90.0 && lat <= 90.0;
    }

    public static boolean isValidLongitude(double lng) {
        return lng >= -180.0 && lng <= 180.0;
    }
}
