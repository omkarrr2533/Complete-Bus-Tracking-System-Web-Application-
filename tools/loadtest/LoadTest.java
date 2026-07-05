import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Zero-dependency load test for CityBus Tracker (run with `java LoadTest.java`).
 *
 * Simulates the real workload shape:
 *   - N rider WebSocket connections that register and receive broadcasts
 *   - 5 authenticated driver connections streaming GPS pings every second
 *   - a pool of REST clients hammering /api/v1/routes and /api/v1/journeys
 *
 * Reports message delivery totals and REST latency percentiles.
 *
 * Usage: java LoadTest.java [baseUrl] [riders] [restWorkers] [seconds]
 */
public class LoadTest {

    public static void main(String[] args) throws Exception {
        String base = args.length > 0 ? args[0] : "http://localhost:8081";
        int riders = args.length > 1 ? Integer.parseInt(args[1]) : 300;
        int restWorkers = args.length > 2 ? Integer.parseInt(args[2]) : 40;
        int seconds = args.length > 3 ? Integer.parseInt(args[3]) : 30;
        String wsBase = base.replaceFirst("^http", "ws");

        System.out.printf("Load test: %s | %d riders | %d REST workers | %ds%n",
                base, riders, restWorkers, seconds);

        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .executor(Executors.newVirtualThreadPerTaskExecutor())
                .build();

        AtomicBoolean running = new AtomicBoolean(true);
        AtomicLong wsMessagesReceived = new AtomicLong();
        AtomicLong wsConnectFailures = new AtomicLong();
        ConcurrentLinkedQueue<Long> routesLatencies = new ConcurrentLinkedQueue<>();
        ConcurrentLinkedQueue<Long> journeyLatencies = new ConcurrentLinkedQueue<>();
        AtomicLong restErrors = new AtomicLong();

        // ── 1. Rider WebSocket connections ────────────────────────────
        WebSocket.Listener riderListener = new WebSocket.Listener() {
            @Override
            public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                wsMessagesReceived.incrementAndGet();
                ws.request(1);
                return null;
            }
        };

        List<WebSocket> riderSockets = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch connected = new CountDownLatch(riders);
        long connectStart = System.nanoTime();
        for (int i = 0; i < riders; i++) {
            final int id = i;
            http.newWebSocketBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .buildAsync(URI.create(wsBase + "/websocket"), riderListener)
                    .whenComplete((ws, err) -> {
                        if (err != null) {
                            wsConnectFailures.incrementAndGet();
                        } else {
                            ws.sendText("{\"type\":\"user-register\",\"data\":{\"userId\":\"load-rider-" + id + "\"}}", true);
                            riderSockets.add(ws);
                        }
                        connected.countDown();
                    });
        }
        connected.await(60, TimeUnit.SECONDS);
        long connectMs = (System.nanoTime() - connectStart) / 1_000_000;
        System.out.printf("Riders connected: %d/%d in %d ms (failures: %d)%n",
                riderSockets.size(), riders, connectMs, wsConnectFailures.get());

        // ── 2. Authenticated drivers streaming GPS ────────────────────
        ExecutorService drivers = Executors.newVirtualThreadPerTaskExecutor();
        for (int d = 1; d <= 5; d++) {
            final int driverNum = d;
            drivers.submit(() -> {
                try {
                    String login = "{\"username\":\"driver" + driverNum + "\",\"password\":\"password123\"}";
                    HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(base + "/api/v1/auth/login"))
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(login)).build(),
                            HttpResponse.BodyHandlers.ofString());
                    if (res.statusCode() != 200) {
                        System.out.println("driver" + driverNum + " login failed: " + res.statusCode());
                        return;
                    }
                    String token = res.body().replaceAll(".*\"accessToken\":\"([^\"]+)\".*", "$1");
                    WebSocket ws = http.newWebSocketBuilder()
                            .buildAsync(URI.create(wsBase + "/websocket"), new WebSocket.Listener() {})
                            .join();
                    ws.sendText("{\"type\":\"driver-register\",\"data\":{\"token\":\"" + token + "\"}}", true).join();

                    double lat = 19.85 + driverNum * 0.002;
                    double lng = 75.30;
                    while (running.get()) {
                        lng += 0.0004; // ~44 m per tick ≈ real bus speed
                        ws.sendText("{\"type\":\"driver-location\",\"data\":{\"coords\":[" + lat + "," + lng + "],\"accuracy\":8,\"visible\":true}}", true);
                        Thread.sleep(1000);
                    }
                    ws.sendClose(WebSocket.NORMAL_CLOSURE, "done");
                } catch (Exception e) {
                    System.out.println("driver" + driverNum + " error: " + e.getMessage());
                }
            });
        }

        // ── 3. REST hammering ──────────────────────────────────────────
        ExecutorService rest = Executors.newVirtualThreadPerTaskExecutor();
        for (int w = 0; w < restWorkers; w++) {
            final boolean journeyWorker = w % 2 == 0;
            rest.submit(() -> {
                while (running.get()) {
                    String path = journeyWorker
                            ? "/api/v1/journeys?fromLat=19.877&fromLng=75.365&toLat=19.833&toLng=75.291"
                            : "/api/v1/routes";
                    long start = System.nanoTime();
                    try {
                        HttpResponse<Void> res = http.send(
                                HttpRequest.newBuilder(URI.create(base + path)).GET().build(),
                                HttpResponse.BodyHandlers.discarding());
                        long micros = (System.nanoTime() - start) / 1_000;
                        if (res.statusCode() == 200) {
                            (journeyWorker ? journeyLatencies : routesLatencies).add(micros);
                        } else if (res.statusCode() != 404) {
                            restErrors.incrementAndGet();
                        }
                    } catch (Exception e) {
                        restErrors.incrementAndGet();
                    }
                }
            });
        }

        // ── 4. Run, then report ────────────────────────────────────────
        Thread.sleep(seconds * 1000L);
        running.set(false);
        rest.shutdown();
        drivers.shutdown();
        rest.awaitTermination(5, TimeUnit.SECONDS);
        drivers.awaitTermination(5, TimeUnit.SECONDS);

        System.out.println("──────────────────────────────────────────────");
        System.out.printf("WS broadcasts delivered to riders : %,d msgs (%,.0f msg/s)%n",
                wsMessagesReceived.get(), wsMessagesReceived.get() / (double) seconds);
        report("GET /api/v1/routes   ", routesLatencies, seconds);
        report("GET /api/v1/journeys ", journeyLatencies, seconds);
        System.out.printf("REST errors                       : %d%n", restErrors.get());

        riderSockets.forEach(ws -> ws.sendClose(WebSocket.NORMAL_CLOSURE, "done"));
        Thread.sleep(1500);
        System.out.println("Done.");
    }

    private static void report(String name, ConcurrentLinkedQueue<Long> latencies, int seconds) {
        List<Long> sorted = new ArrayList<>(latencies);
        if (sorted.isEmpty()) {
            System.out.printf("%s: no samples%n", name);
            return;
        }
        Collections.sort(sorted);
        System.out.printf("%s: %,d reqs (%,.0f req/s) | p50 %.1f ms | p95 %.1f ms | p99 %.1f ms%n",
                name, sorted.size(), sorted.size() / (double) seconds,
                pct(sorted, 50) / 1000.0, pct(sorted, 95) / 1000.0, pct(sorted, 99) / 1000.0);
    }

    private static long pct(List<Long> sorted, int p) {
        return sorted.get(Math.min(sorted.size() - 1, (int) Math.ceil(p / 100.0 * sorted.size()) - 1));
    }
}
