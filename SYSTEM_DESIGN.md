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
- Drivers sign in and stream GPS positions; they can hide themselves (break/off-duty).
- Admins **create/update/delete routes and buses**; changes propagate to the rider map immediately.

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

Current scale: one JVM handles hundreds of concurrent WebSocket clients and
dozens of buses without breaking a sweat. What changes at 100× — and what I'd do:

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
4. **Push at scale**: 10 s full-fleet snapshots to every rider stop scaling at
   ~10k concurrent riders; switch to per-route subscriptions (rider subscribes
   to the route they're viewing) to cut fan-out by ~10×.

Trade-offs accepted at current scale (all documented on purpose):
- In-memory live state ⇒ lost on restart (cost: one reconnect round-trip).
- Whole-cache eviction ⇒ momentary extra DB reads after an admin edit.
- Fixed-window rate limiting ⇒ small burst at window edges (vs sliding window).
- H2 file DB ⇒ single-writer; fine for one instance, swapped for Postgres beyond.

---

## 7. Testing

38 tests, three layers:
- **Unit**: JWT issue/parse/tamper/expiry; haversine math; ring-buffer speed
  computation incl. GPS-jump clamping; proximity alert threshold + cooldown.
- **Repository/service** (`@DataJpaTest`): route CRUD, duplicate route number
  conflicts, path validation, stop replacement on update.
- **Integration** (`@SpringBootTest` + MockMvc, real filter chain): login,
  anonymous read OK / anonymous write 401 / driver write 403 / admin write
  201, validation field errors, delete conflicts, pagination shape.

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
