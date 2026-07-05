package com.citybus.config;

import com.citybus.domain.Bus;
import com.citybus.domain.GeoPoint;
import com.citybus.domain.Route;
import com.citybus.domain.Stop;
import com.citybus.domain.UserAccount;
import com.citybus.domain.UserRole;
import com.citybus.repository.BusRepository;
import com.citybus.repository.RouteRepository;
import com.citybus.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.List;

/**
 * Seeds the Aurangabad route network, fleet and accounts on first boot.
 * Idempotent: skips seeding when data already exists, so the file-based
 * H2 database survives restarts without duplication.
 */
@Component
@Profile("!test")
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final RouteRepository routeRepository;
    private final BusRepository busRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(RouteRepository routeRepository,
                      BusRepository busRepository,
                      UserRepository userRepository,
                      PasswordEncoder passwordEncoder) {
        this.routeRepository = routeRepository;
        this.busRepository = busRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (routeRepository.count() > 0) {
            log.info("Database already seeded ({} routes) — skipping", routeRepository.count());
            return;
        }

        Route r1 = route(1, "Ranjangaon Phata", "#1d4ed8", "06:00", "22:00", 15,
                path(new double[][]{
                        {19.851408, 75.209897}, {19.840466, 75.232433}, {19.845526, 75.240380},
                        {19.838546, 75.251527}, {19.837301, 75.253563}, {19.847091, 75.265890},
                        {19.832842, 75.270292}, {19.827377, 75.289950}, {19.832516, 75.290357}}),
                List.of(
                        new Stop("Ranjangaon Phata", 19.851408, 75.209897),
                        new Stop("Alphonsa", 19.840466, 75.232433),
                        new Stop("Pratap Chowk", 19.839425, 75.241251),
                        new Stop("MIDC Road", 19.838546, 75.251527),
                        new Stop("Gollwadi Chowk", 19.847091, 75.265890),
                        new Stop("Paithan Road", 19.827377, 75.289950),
                        new Stop("CSMSS", 19.832516, 75.290357)));

        Route r2 = route(2, "Fame Tapadia Signal", "#0f766e", "05:30", "22:30", 20,
                path(new double[][]{
                        {19.876796, 75.366045}, {19.883883, 75.365047}, {19.895284, 75.364767},
                        {19.904718, 75.357021}, {19.909854, 75.353163}, {19.914915, 75.352384},
                        {19.906784, 75.343839}, {19.904839, 75.342060}, {19.894397, 75.337078},
                        {19.892250, 75.327619}, {19.884206, 75.317144}, {19.861054, 75.310145},
                        {19.832545, 75.290382}}),
                List.of(
                        new Stop("Fame Tapadia Signal", 19.876796, 75.366045),
                        new Stop("N1 Ganpati", 19.883883, 75.365047),
                        new Stop("Wokhardt", 19.895284, 75.364767),
                        new Stop("Ambedkar Chowk", 19.898180, 75.362212),
                        new Stop("Jaiswal Hall", 19.904718, 75.357021),
                        new Stop("Railway Station", 19.861054, 75.310145),
                        new Stop("CSMSS", 19.832545, 75.290382)));

        Route r3 = route(3, "Chikalthana", "#7c3aed", "05:30", "22:30", 20,
                path(new double[][]{
                        {19.873573, 75.394782}, {19.869982, 75.394397}, {19.871974, 75.385324},
                        {19.873522, 75.370390}, {19.874840, 75.355761}, {19.875275, 75.352356},
                        {19.876049, 75.341475}, {19.873642, 75.328705}, {19.872266, 75.322000},
                        {19.860902, 75.310143}, {19.861369, 75.306988}, {19.847678, 75.296336},
                        {19.833201, 75.290463}}),
                List.of(
                        new Stop("Chikalthana", 19.873573, 75.394782),
                        new Stop("Dhoot Hospital", 19.869982, 75.394397),
                        new Stop("Akashwani", 19.876049, 75.341475),
                        new Stop("Jai Tower", 19.861369, 75.306988),
                        new Stop("CSMSS", 19.833201, 75.290463)));

        Route r4 = route(4, "Baliram Patil High School", "#d97706", "06:30", "21:30", 18,
                path(new double[][]{
                        {19.895877, 75.358173}, {19.888110, 75.360340}, {19.879980, 75.360448},
                        {19.875295, 75.353286}, {19.869060, 75.350870}, {19.858987, 75.344975},
                        {19.857757, 75.334539}, {19.850451, 75.333036}, {19.854130, 75.305745},
                        {19.841854, 75.293056}, {19.832519, 75.290360}}),
                List.of(
                        new Stop("Baliram Patil High School", 19.895877, 75.358173),
                        new Stop("Seven Hills Signal", 19.875295, 75.353286),
                        new Stop("Shivaji Nagar", 19.857757, 75.334539),
                        new Stop("CSMSS", 19.832519, 75.290360)));

        routeRepository.saveAll(List.of(r1, r2, r3, r4));

        Bus bus1 = busRepository.save(new Bus("bus-1", r1));
        Bus bus2 = busRepository.save(new Bus("bus-2", r2));
        Bus bus3 = busRepository.save(new Bus("bus-3", r3));
        Bus bus4 = busRepository.save(new Bus("bus-4", r4));
        Bus bus5 = busRepository.save(new Bus("bus-5", r1));

        userRepository.save(new UserAccount("admin", passwordEncoder.encode("admin123"),
                "Fleet Administrator", UserRole.ADMIN, null));
        userRepository.save(new UserAccount("driver1", passwordEncoder.encode("password123"),
                "Driver One", UserRole.DRIVER, bus1));
        userRepository.save(new UserAccount("driver2", passwordEncoder.encode("password123"),
                "Driver Two", UserRole.DRIVER, bus2));
        userRepository.save(new UserAccount("driver3", passwordEncoder.encode("password123"),
                "Driver Three", UserRole.DRIVER, bus3));
        userRepository.save(new UserAccount("driver4", passwordEncoder.encode("password123"),
                "Driver Four", UserRole.DRIVER, bus4));
        userRepository.save(new UserAccount("driver5", passwordEncoder.encode("password123"),
                "Driver Five", UserRole.DRIVER, bus5));

        log.info("Seeded {} routes, {} buses, {} users",
                routeRepository.count(), busRepository.count(), userRepository.count());
    }

    private Route route(int number, String name, String color, String firstBus, String lastBus,
                        int frequencyMinutes, List<GeoPoint> path, List<Stop> stops) {
        Route route = new Route();
        route.setRouteNumber(number);
        route.setName(name);
        route.setColor(color);
        route.setFirstBus(LocalTime.parse(firstBus));
        route.setLastBus(LocalTime.parse(lastBus));
        route.setFrequencyMinutes(frequencyMinutes);
        route.setActive(true);
        route.setPath(path);
        route.setStops(stops);
        return route;
    }

    private List<GeoPoint> path(double[][] points) {
        return java.util.Arrays.stream(points)
                .map(p -> new GeoPoint(p[0], p[1]))
                .toList();
    }
}
