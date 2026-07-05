package com.citybus.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A bus route: an ordered polyline (path) plus an ordered list of named stops,
 * with basic timetable metadata. Optimistically locked via {@code @Version} so
 * concurrent admin edits fail fast instead of silently overwriting each other.
 */
@Entity
@Table(name = "routes", uniqueConstraints = @UniqueConstraint(columnNames = "route_number"))
public class Route {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "route_number", nullable = false)
    private int routeNumber;

    @Column(nullable = false, length = 100)
    private String name;

    /** Hex color used by the map UI to draw this route's polyline. */
    @Column(nullable = false, length = 7)
    private String color;

    @Column(name = "first_bus", nullable = false)
    private LocalTime firstBus;

    @Column(name = "last_bus", nullable = false)
    private LocalTime lastBus;

    @Column(name = "frequency_minutes", nullable = false)
    private int frequencyMinutes;

    @Column(nullable = false)
    private boolean active = true;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(name = "route_path", joinColumns = @JoinColumn(name = "route_id"))
    @OrderColumn(name = "seq")
    private List<GeoPoint> path = new ArrayList<>();

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @JoinColumn(name = "route_id", nullable = false)
    @OrderColumn(name = "seq")
    private List<Stop> stops = new ArrayList<>();

    @Version
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public int getRouteNumber() {
        return routeNumber;
    }

    public void setRouteNumber(int routeNumber) {
        this.routeNumber = routeNumber;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public LocalTime getFirstBus() {
        return firstBus;
    }

    public void setFirstBus(LocalTime firstBus) {
        this.firstBus = firstBus;
    }

    public LocalTime getLastBus() {
        return lastBus;
    }

    public void setLastBus(LocalTime lastBus) {
        this.lastBus = lastBus;
    }

    public int getFrequencyMinutes() {
        return frequencyMinutes;
    }

    public void setFrequencyMinutes(int frequencyMinutes) {
        this.frequencyMinutes = frequencyMinutes;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public List<GeoPoint> getPath() {
        return path;
    }

    public void setPath(List<GeoPoint> path) {
        this.path.clear();
        this.path.addAll(path);
    }

    public List<Stop> getStops() {
        return stops;
    }

    public void setStops(List<Stop> stops) {
        this.stops.clear();
        this.stops.addAll(stops);
    }

    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
