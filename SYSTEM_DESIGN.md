# CityBus Tracker — System Design

Real-time city bus tracking platform for Aurangabad: riders see live bus
positions and honest ETAs, drivers broadcast GPS from a phone, and admins
manage the route network and fleet through a CRUD console.

This document explains the architecture, the data model, and — most
importantly — **why** each decision was made and what its trade-offs are.

---

## 1. Requirements

### Functional
- Riders view routes, stops, schedules and **live bus positions** on a map, without signing in.
- Riders get an **ETA** for a chosen bus and a **proximity alert** when it comes within 500 m.
- Riders plan **door-to-door journeys** with transfers over the live route network.
- Riders see **crowding levels** (reported by drivers) and **service alerts** (published by admins).
- Drivers sign in, stream GPS positions, and report occupancy with one tap; they can hide themselves.
- Admins **create/update/delete routes, buses and alerts**; changes propagate to the rider app immediately — including the journey-planner graph.

### Non-functional
| Concern | Target | How it's met |
|---|---|---|
| Position freshness | ≤ 10 s | WebSocket push, 10 s snapshot broadcast + per-ping fan-out |
| Read latency (routes) | ~ms | Caffeine cache in front of JPA |
| Security | Role-based | JWT (HS256), enforced by a servlet filter chain; driver WS registration re-validates the token |
| Abuse resistance | Login brute force | Fixed-window rate limiter per client IP (10/min) |
| Observability | Health + metrics | Spring Boot Actuator (`/actuator/health`, `/metrics`) |
| API discoverability | Self-documenting | OpenAPI 3 / Swagger UI (`/swagger-ui.html`) |

### Constraints
- Single small VM / laptop demo deployment; zero-install database (file-based H2, PostgreSQL-ready).
- One codebase, one deployable JAR — team of one.

---

## 2. High-level architecture

```
   Rider (index.html)      Driver (driver.html)      Admin (admin.html)
        │  ▲                     │  ▲                      │  ▲
   REST │  │ WS push        WS  │  │ WS ack           REST│  │ JSON
        ▼  │                     ▼  │                      ▼  │
┌──────────┴─────────────────────┴───────────────────────────┴───────────┐
│                        Spring Boot 3 (embedded Tomcat)                  │
│                                                                         │
│  ┌────────────────┐   ┌──────────────────┐   ┌──────────────────────┐  │
│  │ Security chain │   │  REST controllers │  │ WebSocket handler    │  │
│  │ RateLimit →    │   │  /api/v1/auth     │  │ /websocket           │  │
│  │ JWT filter →   │   │  /api/v1/routes   │  │ (transport only)     │  │
│  │ authz rules    │   │  /api/v1/buses    │  └──────────┬───────────┘  │
│  └────────────────┘   └────────┬─────────┘              │              │
│                                │                        │              │
│  ┌─────────────────────────────▼────────┐   ┌───────────▼───────────┐  │
│  │ Services (RouteService, BusService,  │   │ LiveTrackingService   │  │
│  │ AuthService) + Caffeine cache        │   │ in-memory registry:   │  │
│  └─────────────────────────────┬────────┘   │ sessions, ring buffers│  │
│                                │            │ speed, proximity      │  │
│  ┌─────────────────────────────▼────────┐   └───────────────────────┘  │
│  │ Spring Data JPA repositories         │      (no DB writes on the    │
│  └─────────────────────────────┬────────┘       GPS hot path)          │
└────────────────────────────────┼────────────────────────────────────────┘
                                 ▼
                     H2 (file) / PostgreSQL
                routes · route_path · stops · buses · users
```

**Key structural decision — two state stores with different lifetimes:**

1. **Relational store (JPA)** for slow-changing, valuable data: routes, stops,
   buses, users. Full CRUD, validation, optimistic locking, survives restarts.
2. **In-memory registry (`LiveTrackingService`)** for fast-changing, ephemeral
   data: GPS pings, connected sessions, rolling speeds. A bus position from
   40 seconds ago is worthless — persisting every ping would turn a ~1 write/s/bus
   stream into database load with zero payoff. Losing this state on restart
   costs nothing: drivers re-register automatically on WebSocket reconnect.

This is the classic *hot path / cold path* separation, applied at mini-project scale.

---

## 3. Data model

```
users ────────────┐            routes 1 ──── * stops   (ordered by seq)
 id               │             id             id
 username (uq)    │             route_number   name
 password_hash    │  * ┌── 1    (uq)           lat, lng
 display_name     └──▶ buses    name
 role (ADMIN|DRIVER)    id      color          routes 1 ──── * route_path
 bus_id (FK, drivers)   code    first_bus       (GeoPoint @ElementCollection,
                        (uq)    last_bus         ordered by seq)
                        route_id (FK)  frequency_minutes
                        active         active, version,
                                       created_at, updated_at
```

- **Path vs stops are modeled separately.** The polyline (`route_path`) has more
  vertices than stops; conflating them (the old code did) breaks both the map
  rendering and the ETA math.
- **`@Version` on Route** — two admins editing the same route get a 409 instead
  of last-writer-wins silent data loss.
- **BCrypt** password hashes; the JWT never contains anything secret, only
  identity + role claims signed with the server key.
- Referential integrity is enforced in the service layer with friendly errors:
  deleting a route with assigned buses, or a bus with an assigned driver, is a 409.

---

## 4. API contract

`/api/v1` prefix — versioned from day one so a future v2 doesn't break deployed clients.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/login` | public (rate-limited) | Credentials → JWT |
| GET | `/api/v1/auth/me` | any token | Who am I |
| GET | `/api/v1/routes` | public | Route network (cached) |
| GET | `/api/v1/routes/{id}` | public | One route (cached) |
| POST/PUT/DELETE | `/api/v1/routes...` | ADMIN | Route CRUD |
| GET | `/api/v1/buses?page=&size=` | public | Fleet, paginated, live telemetry merged |
| GET | `/api/v1/buses/live` | public | Buses broadcasting right now |
| GET | `/api/v1/buses/code/{code}/history` | public | Recent GPS trace (bounded window) |
| POST/PUT/DELETE | `/api/v1/buses...` | ADMIN | Fleet CRUD |
| GET | `/actuator/health`, `/actuator/metrics` | public / ADMIN | Ops |

**Error contract** — every failure returns the same envelope
(`GlobalExceptionHandler`), so clients parse one shape:

```json
{
  "timestamp": "2026-07-05T09:12:44Z",
  "status": 400,
  "error": "Validation Failed",
  "message": "One or more fields are invalid",
  "path": "/api/v1/routes",
  "fieldErrors": [{ "field": "color", "message": "Color must be a hex value like #1d4ed8" }]
}
```

**WebSocket protocol** (`/websocket`, JSON `{type, data}`):
- Driver: `driver-register {token}` → server validates the JWT and takes the
  bus assignment **from the token claims**, so a driver cannot broadcast as a
  different vehicle. Then `driver-location {coords, accuracy, visible}`.
- Rider: `user-register`, `user-location`, `track-bus`.
- Server → rider: `active-buses` (10 s snapshot), `bus-location-update`
  (per-ping, includes `speedKmh`), `driver-left`, `proximity-alert`.

---

## 5. Deep dives

### 5.0 Journey planner — Dijkstra over a compiled transit graph
The route network is compiled into a directed graph: **nodes are (route, stop)
pairs** — the same street corner served by two routes is two nodes, because
"standing there about to board route 1" and "about to board route 3" differ
by a transfer wait. Edges:
- **RIDE** between consecutive stops: cost = along-polyline distance at city
  bus speed + dwell time. Added in both directions (symmetric-service
  assumption — the seed data stores each corridor once).
- **TRANSFER** between stops of different routes within 400 m: walk time +
  half the target route's headway as expected wait.
- Virtual origin/destination nodes connect by walking (≤1.5 km) to nearby
  stops; boarding edges also carry the headway/2 wait.

Dijkstra yields the fastest plan, folded into human legs (walk → ride →
walk…), each with drawable polyline geometry sliced from the route path. If
plain walking beats the bus, the planner says so — it never forces a ride.
The graph is **immutable and swapped atomically**; route mutations publish a
Spring `RoutesChangedEvent` that drops it, and the next query rebuilds from
committed data (an event-driven cache-invalidation pattern that keeps
`RouteService` unaware the planner exists). Build cost is O(stops²) for
transfer detection — milliseconds at city scale; the classic Dijkstra
pitfall is avoided by storing the **distance at insertion time** in the
priority queue instead of comparing against the live array.

### 5.0b Occupancy + route-scoped fan-out
Drivers report crowding (LOW/MEDIUM/FULL) over the socket; it rides along on
every subsequent broadcast. Riders can `subscribe-route` to the route they
are viewing, and per-ping updates then fan out **only to subscribers of that
bus's route** — at high rider counts this divides broadcast volume by
roughly the number of routes. Full snapshots still go to everyone every 10 s
so overview maps stay complete. Route identity (number + color) is resolved
once at driver registration, so the hot path never touches the database.

### 5.1 Measured-speed ETA (not a hardcoded guess)
Every bus keeps a **ring buffer of its last 60 GPS fixes**. Speed = total
haversine distance / total time across the buffer, ignoring sub-500 ms sample
gaps and clamping at 120 km/h (GPS jitter produces teleports). The ETA engine
in the rider client projects both the bus and the rider onto the route
polyline and divides the along-route distance by the **measured** speed,
falling back to a 20 km/h city average only while the bus is stationary.
The UI labels which one it used ("Live GPS speed" vs "Estimated").

### 5.2 Caching strategy
Routes are read by every map client and change only when an admin edits them
— a textbook cache candidate. `@Cacheable("routes")` with Caffeine
(max 500 entries, 10 min TTL) and `@CacheEvict(allEntries = true)` on every
write. Whole-cache eviction is deliberately coarse: with tens of routes,
correctness-simplicity beats fine-grained invalidation. Live positions are
**never cached** — freshness is the product.

### 5.3 Security model
- Stateless JWT: no server session store, horizontal-scale friendly.
- The filter chain order matters: rate limiter → JWT parse → authorization rules.
- Public reads / ADMIN writes are enforced **centrally** in `SecurityConfig`,
  not per-controller, so a new endpoint is secure by default.
- The WebSocket layer does its own token check at `driver-register` because
  the HTTP filter chain does not protect socket *messages*, only the handshake.
- Login responses use one generic "Invalid username or password" — no
  username enumeration.
- Secret comes from `JWT_SECRET` env var; a short key fails startup fast.

### 5.4 Concurrency
- All registries are `ConcurrentHashMap`; per-bus ring buffers synchronize on
  themselves (single writer — the driver's session — plus cheap readers).
- WebSocket sessions are wrapped in `ConcurrentWebSocketSessionDecorator`
  because the 10 s broadcast (scheduler thread) and per-message acks (I/O
  thread) may write to the same socket concurrently — the raw session throws.
  Slow consumers get dropped frames, not a blocked broadcast loop.

### 5.5 Failure handling
- Client WebSockets auto-reconnect with a 5 s backoff; drivers re-register on
  reconnect (server state rebuilds itself).
- Stale sessions (no traffic for 2 min) are evicted by a sweeper; riders get
  `driver-left` so ghost buses disappear from the map.
- The service worker is network-first for app code — a deploy reaches users on
  the next load, and the cache only serves as an offline fallback.

---

## 6. Scaling story (interview material)

### Measured, not claimed
`tools/loadtest/LoadTest.java` (zero-dependency, JDK HttpClient + WebSocket)
simulates the real workload shape: hundreds of rider sockets, five
authenticated drivers streaming GPS every second, and REST workers hammering
the routes and journey-planner endpoints. On a single laptop **running both
the server and the load generator**, warmed up:

```
300/300 rider WebSockets connected (0 failures)
WS broadcasts delivered : 46,800 msgs in 30 s  (~1,560 msg/s)
GET /api/v1/routes      : 238 req/s | p50  59 ms | p95 211 ms | p99 646 ms
GET /api/v1/journeys    : 221 req/s | p50  63 ms | p95 227 ms | p99 809 ms
REST errors             : 0
```

Request handling runs on **virtual threads** (Java 21,
`spring.threads.virtual.enabled=true`): each of the hundreds of concurrent
connections costs kilobytes of heap instead of a platform-thread stack, so
concurrency is bounded by work, not by thread-pool size.

### What changes at 100×
Current scale: one JVM comfortably serves hundreds of concurrent clients.
Beyond that:

1. **Multiple app instances** behind a load balancer:
   - The JWT layer needs nothing — stateless by design.
   - `LiveTrackingService` state becomes per-instance. Move the bus registry
     to **Redis** (`GEOADD`/hashes + TTL) and fan out updates via **Redis
     pub/sub or Kafka** so a rider connected to instance A sees a driver on
     instance B. The service interface stays; only the implementation swaps.
   - The login rate limiter moves to a shared Redis token bucket.
2. **Database**: flip the JDBC URL to PostgreSQL (schema is portable),
   add read replicas if route reads outgrow the cache (unlikely — cache hit
   ratio is ~100% between edits).
3. **Telemetry history**: if we need trip playback/analytics, pings go to an
   append-only store (TimescaleDB / S3 parquet) via an async queue — still
   never on the request path.
4. **Push at scale**: per-route subscriptions are already implemented — a
   rider watching route 2 only receives route 2's pings. The next step at
   ~10k riders is moving the remaining full-fleet snapshot to per-route
   topics as well, and sharding subscriptions across instances via pub/sub.
5. **Journey planner**: the graph is per-instance and rebuilt from the DB, so
   it scales horizontally for free; at metro scale (10⁵ stops) swap Dijkstra
   for a contraction-hierarchy or RAPTOR implementation behind the same API.

Trade-offs accepted at current scale (all documented on purpose):
- In-memory live state ⇒ lost on restart (cost: one reconnect round-trip).
- Whole-cache eviction ⇒ momentary extra DB reads after an admin edit.
- Fixed-window rate limiting ⇒ small burst at window edges (vs sliding window).
- H2 file DB ⇒ single-writer; fine for one instance, swapped for Postgres beyond.

---

## 7. Testing

50 tests, three layers:
- **Unit**: JWT issue/parse/tamper/expiry; haversine math; ring-buffer speed
  computation incl. GPS-jump clamping; proximity alert threshold + cooldown;
  occupancy round-trips; route-subscription filtering.
- **Repository/service** (`@DataJpaTest`): route CRUD, duplicate route number
  conflicts, path validation, stop replacement on update; **journey planner**
  — direct rides, transfers between routes, walk-only fallback, unreachable
  → 404, graph rebuild after route change, inactive-route exclusion.
- **Integration** (`@SpringBootTest` + MockMvc, real filter chain): login,
  anonymous read OK / anonymous write 401 / driver write 403 / admin write
  201, validation field errors, delete conflicts, pagination shape.
- **Load** (`tools/loadtest`): 300 concurrent WS riders + REST, run manually;
  results in §6.

---

## 8. Running

```bash
mvn spring-boot:run          # http://localhost:8081
mvn test                     # full suite
```

| Surface | URL | Credentials |
|---|---|---|
| Rider app | `/` | none |
| Driver dashboard | `/driver` | driver1–driver5 / password123 |
| Admin console | `/admin` | admin / admin123 |
| Swagger UI | `/swagger-ui.html` | login for admin ops |
| H2 console (dev) | `/h2-console` | JDBC `jdbc:h2:file:./data/citybus`, user `sa` |
| Health | `/actuator/health` | none |

Production overrides: `JWT_SECRET` (required), `app.cors.allowed-origins`,
PostgreSQL datasource URL.
