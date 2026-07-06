package com.citybus.service;

import com.citybus.domain.GeoPoint;
import com.citybus.domain.Route;
import com.citybus.domain.Stop;
import com.citybus.dto.JourneyDto;
import com.citybus.exception.BadRequestException;
import com.citybus.exception.ResourceNotFoundException;
import com.citybus.repository.RouteRepository;
import com.citybus.util.GeoUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.PriorityQueue;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

/**
 * Door-to-door journey planning over the bus network.
 *
 * The route network is compiled into a directed graph:
 *   nodes  = (route, stop) pairs — the same physical corner served by two
 *            routes is two nodes, because being there "on route 1" vs
 *            "on route 3" differ by a transfer wait;
 *   edges  = RIDE hops between consecutive stops (cost from along-polyline
 *            distance at city bus speed + dwell time) and TRANSFER walks
 *            between nearby stops of different routes (walk time + half the
 *            target route's headway as expected wait).
 * Origin and destination are virtual nodes connected by walking edges to
 * every stop within reach; boarding edges also carry the headway/2 wait.
 * Dijkstra then yields the fastest door-to-door plan, which is folded into
 * human legs (walk → ride → walk...), each with drawable geometry.
 *
 * The graph is immutable once built and swapped atomically; any route
 * mutation publishes {@link RoutesChangedEvent} which drops the graph, and
 * the next query rebuilds it from committed data. Build cost is O(stops²)
 * for transfer detection — milliseconds at city scale.
 */
@Service
public class JourneyPlannerService {

    private static final Logger log = LoggerFactory.getLogger(JourneyPlannerService.class);

    static final double BUS_SPEED_KMH = 20.0;
    static final double WALK_SPEED_KMH = 4.5;
    static final double MAX_TRANSFER_WALK_KM = 0.4;
    static final double MAX_ACCESS_WALK_KM = 1.5;
    static final double MAX_WALK_ONLY_KM = 2.0;
    static final double DWELL_MINUTES_PER_STOP = 0.4;
    /** Straight-line → street-distance correction when path geometry is unusable. */
    static final double INDIRECTNESS = 1.25;
    private static final int MAX_ACCESS_CANDIDATES = 10;

    // ── Graph model ────────────────────────────────────────────────────

    private record Projection(int segment, double t, double cumKm) {
    }

    private record Node(int id, Route route, int stopIndex, Stop stop, Projection onPath) {
    }

    private enum EdgeKind { RIDE, TRANSFER }

    private record Edge(int to, double minutes, double km, EdgeKind kind) {
    }

    private record Graph(List<Node> nodes, List<List<Edge>> adjacency,
                         List<List<double[]>> paths) {
    }

    private final RouteRepository routeRepository;
    private final AtomicReference<Graph> graphRef = new AtomicReference<>();

    public JourneyPlannerService(RouteRepository routeRepository) {
        this.routeRepository = routeRepository;
    }

    @EventListener(RoutesChangedEvent.class)
    public void onRoutesChanged() {
        graphRef.set(null);
        log.info("Journey graph invalidated after route change");
    }

    // ── Public API ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public JourneyDto.Response plan(double fromLat, double fromLng, double toLat, double toLng) {
        if (!GeoUtils.isValidLatitude(fromLat) || !GeoUtils.isValidLongitude(fromLng)
                || !GeoUtils.isValidLatitude(toLat) || !GeoUtils.isValidLongitude(toLng)) {
            throw new BadRequestException("Coordinates out of range");
        }
        double directWalkKm = GeoUtils.distanceKm(fromLat, fromLng, toLat, toLng) * INDIRECTNESS;
        if (directWalkKm < 0.02) {
            throw new BadRequestException("Origin and destination are the same place");
        }

        Graph graph = graph();
        JourneyDto.Response transit = graph.nodes().isEmpty()
                ? null
                : planTransit(graph, fromLat, fromLng, toLat, toLng);

        // Honest fallback: if walking beats the bus (or there is no bus), say so.
        if (directWalkKm <= MAX_WALK_ONLY_KM) {
            double walkMinutes = directWalkKm / WALK_SPEED_KMH * 60;
            if (transit == null || walkMinutes <= transit.totalMinutes()) {
                return walkOnly(fromLat, fromLng, toLat, toLng, directWalkKm, walkMinutes);
            }
        }
        if (transit == null) {
            throw new ResourceNotFoundException(
                    "No journey found — both points are too far from the bus network");
        }
        return transit;
    }

    // ── Graph construction ─────────────────────────────────────────────

    private Graph graph() {
        Graph graph = graphRef.get();
        if (graph != null) {
            return graph;
        }
        synchronized (this) {
            graph = graphRef.get();
            if (graph == null) {
                graph = build();
                graphRef.set(graph);
            }
            return graph;
        }
    }

    private Graph build() {
        long started = System.nanoTime();
        List<Route> routes = routeRepository.findAllByOrderByRouteNumberAsc().stream()
                .filter(Route::isActive)
                .filter(r -> r.getStops().size() >= 2)
                .toList();

        List<Node> nodes = new ArrayList<>();
        List<List<double[]>> paths = new ArrayList<>();

        for (Route route : routes) {
            List<double[]> path = route.getPath().stream()
                    .map(p -> new double[]{p.getLat(), p.getLng()})
                    .toList();
            paths.add(path);
            List<Stop> stops = route.getStops();
            for (int i = 0; i < stops.size(); i++) {
                Stop stop = stops.get(i);
                Projection proj = project(stop.getLat(), stop.getLng(), path);
                nodes.add(new Node(nodes.size(), route, i, stop, proj));
            }
        }

        List<List<Edge>> adjacency = new ArrayList<>(nodes.size());
        for (int i = 0; i < nodes.size(); i++) {
            adjacency.add(new ArrayList<>());
        }

        // RIDE edges between consecutive stops of the same route. Added in
        // both directions: the seed data stores each corridor once, but city
        // buses serve it both ways (symmetric-service assumption).
        for (Node node : nodes) {
            if (node.stopIndex() + 1 >= node.route().getStops().size()) {
                continue;
            }
            Node next = nodes.get(node.id() + 1); // stops of a route are contiguous
            double km = next.onPath().cumKm() - node.onPath().cumKm();
            if (km <= 0.001) { // degenerate projection — fall back to crow-flies
                km = GeoUtils.distanceKm(node.stop().getLat(), node.stop().getLng(),
                        next.stop().getLat(), next.stop().getLng()) * INDIRECTNESS;
            }
            double minutes = km / BUS_SPEED_KMH * 60 + DWELL_MINUTES_PER_STOP;
            adjacency.get(node.id()).add(new Edge(next.id(), minutes, km, EdgeKind.RIDE));
            adjacency.get(next.id()).add(new Edge(node.id(), minutes, km, EdgeKind.RIDE));
        }

        // TRANSFER edges between nearby stops of different routes
        for (Node a : nodes) {
            for (Node b : nodes) {
                if (a.route().getId().equals(b.route().getId())) {
                    continue;
                }
                double walkKm = GeoUtils.distanceKm(a.stop().getLat(), a.stop().getLng(),
                        b.stop().getLat(), b.stop().getLng());
                if (walkKm <= MAX_TRANSFER_WALK_KM) {
                    double minutes = walkKm / WALK_SPEED_KMH * 60
                            + b.route().getFrequencyMinutes() / 2.0;
                    adjacency.get(a.id()).add(new Edge(b.id(), minutes, walkKm, EdgeKind.TRANSFER));
                }
            }
        }

        long edges = adjacency.stream().mapToLong(List::size).sum();
        log.info("Journey graph built: {} routes, {} nodes, {} edges in {} ms",
                routes.size(), nodes.size(), edges, (System.nanoTime() - started) / 1_000_000);
        return new Graph(List.copyOf(nodes), List.copyOf(adjacency), List.copyOf(paths));
    }

    // ── Dijkstra + leg folding ─────────────────────────────────────────

    private record Arrival(double minutes, int viaNode, Edge viaEdge) {
    }

    private JourneyDto.Response planTransit(Graph graph, double fromLat, double fromLng,
                                            double toLat, double toLng) {
        int n = graph.nodes().size();
        double[] dist = new double[n];
        Arrival[] arrivals = new Arrival[n];
        Arrays.fill(dist, Double.POSITIVE_INFINITY);

        // Entries hold (node, distance-at-insertion); stale entries are skipped
        // on poll. Reading the live dist[] from the comparator would corrupt
        // the heap once a distance is relaxed after insertion.
        PriorityQueue<double[]> queue = new PriorityQueue<>((x, y) -> Double.compare(x[1], y[1]));

        // Boarding edges: origin → nearby stops, cost = walk + expected wait
        accessCandidates(graph, fromLat, fromLng).forEach(node -> {
            double walkKm = GeoUtils.distanceKm(fromLat, fromLng,
                    node.stop().getLat(), node.stop().getLng()) * INDIRECTNESS;
            double minutes = walkKm / WALK_SPEED_KMH * 60
                    + node.route().getFrequencyMinutes() / 2.0;
            if (minutes < dist[node.id()]) {
                dist[node.id()] = minutes;
                arrivals[node.id()] = new Arrival(minutes, -1, null);
                queue.add(new double[]{node.id(), minutes});
            }
        });

        boolean[] settled = new boolean[n];
        while (!queue.isEmpty()) {
            int u = (int) queue.poll()[0];
            if (settled[u]) {
                continue;
            }
            settled[u] = true;
            for (Edge edge : graph.adjacency().get(u)) {
                double candidate = dist[u] + edge.minutes();
                if (candidate < dist[edge.to()]) {
                    dist[edge.to()] = candidate;
                    arrivals[edge.to()] = new Arrival(candidate, u, edge);
                    queue.add(new double[]{edge.to(), candidate});
                }
            }
        }

        // Alighting: best (node → destination walk)
        int bestNode = -1;
        double bestTotal = Double.POSITIVE_INFINITY;
        double bestEgressKm = 0;
        for (Node node : accessCandidates(graph, toLat, toLng)) {
            if (dist[node.id()] == Double.POSITIVE_INFINITY) {
                continue;
            }
            double walkKm = GeoUtils.distanceKm(toLat, toLng,
                    node.stop().getLat(), node.stop().getLng()) * INDIRECTNESS;
            double total = dist[node.id()] + walkKm / WALK_SPEED_KMH * 60;
            if (total < bestTotal) {
                bestTotal = total;
                bestNode = node.id();
                bestEgressKm = walkKm;
            }
        }
        if (bestNode < 0) {
            return null;
        }
        return fold(graph, arrivals, bestNode, bestTotal, bestEgressKm,
                fromLat, fromLng, toLat, toLng);
    }

    private List<Node> accessCandidates(Graph graph, double lat, double lng) {
        return graph.nodes().stream()
                .filter(node -> GeoUtils.distanceKm(lat, lng,
                        node.stop().getLat(), node.stop().getLng()) <= MAX_ACCESS_WALK_KM)
                .sorted((a, b) -> Double.compare(
                        GeoUtils.distanceKm(lat, lng, a.stop().getLat(), a.stop().getLng()),
                        GeoUtils.distanceKm(lat, lng, b.stop().getLat(), b.stop().getLng())))
                .limit(MAX_ACCESS_CANDIDATES)
                .toList();
    }

    /** Walk the predecessor chain backwards and fold hops into human legs. */
    private JourneyDto.Response fold(Graph graph, Arrival[] arrivals, int lastNode,
                                     double totalMinutes, double egressKm,
                                     double fromLat, double fromLng, double toLat, double toLng) {
        // Recover node sequence (board node → ... → alight node)
        List<Integer> chain = new ArrayList<>();
        for (int at = lastNode; at != -1; at = arrivals[at] == null ? -1 : arrivals[at].viaNode()) {
            chain.add(at);
            if (arrivals[at] == null || arrivals[at].viaEdge() == null && arrivals[at].viaNode() == -1) {
                break;
            }
        }
        java.util.Collections.reverse(chain);

        List<JourneyDto.Leg> legs = new ArrayList<>();
        Node boardNode = graph.nodes().get(chain.get(0));

        // Access walk
        double accessKm = GeoUtils.distanceKm(fromLat, fromLng,
                boardNode.stop().getLat(), boardNode.stop().getLng()) * INDIRECTNESS;
        legs.add(walkLeg("Your location", boardNode.stop().getName(), accessKm,
                List.of(new double[]{fromLat, fromLng},
                        new double[]{boardNode.stop().getLat(), boardNode.stop().getLng()})));

        // Fold ride/transfer hops
        int rideStart = 0;
        int transfers = 0;
        double totalKm = accessKm;
        for (int i = 1; i < chain.size(); i++) {
            Edge edge = arrivals[chain.get(i)].viaEdge();
            boolean lastHop = i == chain.size() - 1;
            if (edge.kind() == EdgeKind.TRANSFER || lastHop) {
                int rideEnd = edge.kind() == EdgeKind.TRANSFER ? i - 1 : i;
                if (rideEnd > rideStart) {
                    JourneyDto.Leg ride = rideLeg(graph, chain, rideStart, rideEnd);
                    legs.add(ride);
                    totalKm += ride.distanceKm();
                }
                if (edge.kind() == EdgeKind.TRANSFER) {
                    Node from = graph.nodes().get(chain.get(i - 1));
                    Node to = graph.nodes().get(chain.get(i));
                    legs.add(walkLeg(from.stop().getName(), to.stop().getName(), edge.km(),
                            List.of(new double[]{from.stop().getLat(), from.stop().getLng()},
                                    new double[]{to.stop().getLat(), to.stop().getLng()})));
                    totalKm += edge.km();
                    transfers++;
                    rideStart = i;
                }
            }
        }

        // Egress walk
        Node alightNode = graph.nodes().get(lastNode);
        legs.add(walkLeg(alightNode.stop().getName(), "Destination", egressKm,
                List.of(new double[]{alightNode.stop().getLat(), alightNode.stop().getLng()},
                        new double[]{toLat, toLng})));
        totalKm += egressKm;

        // A "journey" that never boards a bus is not a transit plan —
        // let the caller fall back to plain walking.
        if (legs.stream().noneMatch(l -> "RIDE".equals(l.mode()))) {
            return null;
        }

        String summary = legs.stream()
                .filter(l -> "RIDE".equals(l.mode()))
                .map(l -> "Route " + l.routeNumber())
                .collect(Collectors.joining(" → "));
        return new JourneyDto.Response(
                round1(totalMinutes),
                round2(totalKm),
                transfers,
                summary.isEmpty() ? "Walk" : summary,
                legs);
    }

    private JourneyDto.Leg rideLeg(Graph graph, List<Integer> chain, int startIdx, int endIdx) {
        Node from = graph.nodes().get(chain.get(startIdx));
        Node to = graph.nodes().get(chain.get(endIdx));
        Route route = from.route();
        int routeIdx = routeIndexOf(graph, route);

        double km = 0;
        double minutes = 0;
        for (int i = startIdx + 1; i <= endIdx; i++) {
            Edge edge = null;
            for (Edge e : graph.adjacency().get(chain.get(i - 1))) {
                if (e.to() == chain.get(i) && e.kind() == EdgeKind.RIDE) {
                    edge = e;
                    break;
                }
            }
            if (edge != null) {
                km += edge.km();
                minutes += edge.minutes();
            }
        }

        // Reverse-direction rides slice the polyline backwards
        boolean reversed = from.onPath().cumKm() > to.onPath().cumKm();
        List<double[]> geometry = reversed
                ? reverse(subPath(graph.paths().get(routeIdx), to.onPath(), from.onPath()))
                : subPath(graph.paths().get(routeIdx), from.onPath(), to.onPath());
        if (geometry.size() < 2) {
            geometry = List.of(
                    new double[]{from.stop().getLat(), from.stop().getLng()},
                    new double[]{to.stop().getLat(), to.stop().getLng()});
        }
        return new JourneyDto.Leg("RIDE",
                from.stop().getName(), to.stop().getName(),
                route.getRouteNumber(), route.getName(), route.getColor(),
                endIdx - startIdx,
                round1(route.getFrequencyMinutes() / 2.0),
                round2(km), round1(minutes), geometry);
    }

    private JourneyDto.Leg walkLeg(String fromName, String toName, double km, List<double[]> geometry) {
        return new JourneyDto.Leg("WALK", fromName, toName,
                null, null, null, null, null,
                round2(km), round1(km / WALK_SPEED_KMH * 60), geometry);
    }

    private JourneyDto.Response walkOnly(double fromLat, double fromLng, double toLat, double toLng,
                                         double km, double minutes) {
        JourneyDto.Leg leg = walkLeg("Your location", "Destination", km,
                List.of(new double[]{fromLat, fromLng}, new double[]{toLat, toLng}));
        return new JourneyDto.Response(round1(minutes), round2(km), 0,
                String.format(Locale.US, "Walk %.1f km", km), List.of(leg));
    }

    private int routeIndexOf(Graph graph, Route route) {
        int idx = 0;
        Long prev = null;
        for (Node node : graph.nodes()) {
            if (prev != null && !node.route().getId().equals(prev)) {
                idx++;
            }
            if (node.route().getId().equals(route.getId())) {
                return idx;
            }
            prev = node.route().getId();
        }
        return 0;
    }

    // ── Polyline geometry ──────────────────────────────────────────────

    /** Nearest position on the polyline: segment index, fraction along it, cumulative km. */
    private static Projection project(double lat, double lng, List<double[]> path) {
        if (path.size() < 2) {
            return new Projection(0, 0, 0);
        }
        int bestSeg = 0;
        double bestT = 0;
        double bestDist = Double.POSITIVE_INFINITY;
        for (int i = 0; i < path.size() - 1; i++) {
            double[] a = path.get(i);
            double[] b = path.get(i + 1);
            double dx = b[0] - a[0];
            double dy = b[1] - a[1];
            double len2 = dx * dx + dy * dy;
            double t = len2 == 0 ? 0
                    : Math.max(0, Math.min(1, ((lat - a[0]) * dx + (lng - a[1]) * dy) / len2));
            double px = a[0] + t * dx;
            double py = a[1] + t * dy;
            double d = GeoUtils.distanceKm(lat, lng, px, py);
            if (d < bestDist) {
                bestDist = d;
                bestSeg = i;
                bestT = t;
            }
        }
        double cum = 0;
        for (int i = 0; i < bestSeg; i++) {
            double[] a = path.get(i);
            double[] b = path.get(i + 1);
            cum += GeoUtils.distanceKm(a[0], a[1], b[0], b[1]);
        }
        double[] a = path.get(bestSeg);
        double[] b = path.get(bestSeg + 1);
        cum += bestT * GeoUtils.distanceKm(a[0], a[1], b[0], b[1]);
        return new Projection(bestSeg, bestT, cum);
    }

    /** Slice of the polyline between two projected positions (for drawing ride legs). */
    private static List<double[]> subPath(List<double[]> path, Projection from, Projection to) {
        if (path.size() < 2 || from.cumKm() > to.cumKm()) {
            return List.of();
        }
        List<double[]> points = new ArrayList<>();
        double[] a = path.get(from.segment());
        double[] b = path.get(from.segment() + 1);
        points.add(new double[]{
                a[0] + from.t() * (b[0] - a[0]),
                a[1] + from.t() * (b[1] - a[1])});
        for (int i = from.segment() + 1; i <= to.segment(); i++) {
            points.add(path.get(i));
        }
        double[] c = path.get(to.segment());
        double[] d = path.get(Math.min(to.segment() + 1, path.size() - 1));
        points.add(new double[]{
                c[0] + to.t() * (d[0] - c[0]),
                c[1] + to.t() * (d[1] - c[1])});
        return points;
    }

    private static List<double[]> reverse(List<double[]> points) {
        List<double[]> reversed = new ArrayList<>(points);
        java.util.Collections.reverse(reversed);
        return reversed;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
