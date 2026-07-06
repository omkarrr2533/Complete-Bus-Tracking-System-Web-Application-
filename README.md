# CityBus Tracker

Real-time city bus tracking platform for Aurangabad — live GPS tracking over
WebSockets, measured-speed ETAs, proximity alerts, and a full fleet-management
CRUD console, built on Spring Boot 3.

> Architecture, trade-offs and the scaling story are documented in
> **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)** — read that first if you're
> evaluating the design.

## What it does

| Surface | URL | Who |
|---|---|---|
| **Rider app** | `/` | Public — live map, journey planner, live line diagram, crowding info, ETA panel, service alerts |
| **Driver dashboard** | `/driver` | Drivers — stream GPS, one-tap crowding report, visibility toggle |
| **Admin console** | `/admin` | Admins — CRUD for routes, fleet & service alerts, live operations view |
| **API docs** | `/swagger-ui.html` | OpenAPI 3 with JWT authorize button |
| **Health / metrics** | `/actuator/health` | Ops (custom `citybus.*` metrics under `/actuator/metrics`) |

### Headline features

- **Door-to-door journey planner** — Dijkstra over a graph compiled from the
  route network: walking access/egress, rides along real route geometry, and
  walking transfers between nearby stops of different routes, with expected
  waits from each route's headway. Rebuilt automatically when an admin edits
  a route (Spring event → graph invalidation).
- **Live line diagram** — select a route and see a metro-style stop ladder
  with the bus bead moving between stops in real time.
- **Crowding reports** — drivers tap Seats free / Filling up / Full; riders
  see the badge on bus cards and the ETA panel instantly over WebSocket.
- **Service alerts** — admins publish network-wide or per-route notices with
  severity and expiry; riders get dismissible banners within seconds.
- **Measured-speed ETAs** — a ring buffer of GPS fixes per bus yields a real
  rolling speed; the ETA panel says whether it used live speed or an estimate.
- **Route-aware WebSocket fan-out** — riders subscribe to the route they are
  viewing, cutting per-ping broadcast volume by roughly the number of routes.

Admin edits propagate end-to-end: create or edit a route in the console and
the rider map, routes table, schedule page and journey planner all reflect it
— no hardcoded data anywhere in the frontend.

## Tech stack

- **Backend**: Java 17, Spring Boot 3.3 (Web, Data JPA, Security, WebSocket,
  Validation, Actuator, Cache), H2 file database (PostgreSQL-ready), JJWT,
  Caffeine, springdoc-openapi
- **Frontend**: vanilla JS + Leaflet maps, design-token CSS system with dark
  mode, service worker (network-first)
- **Tests**: 50 JUnit 5 tests — unit, `@DataJpaTest` slices, and
  `@SpringBootTest` + MockMvc integration through the real security filter chain
- **Concurrency**: virtual threads (Java 21) for request handling; a
  zero-dependency load test (`tools/loadtest/LoadTest.java`) simulates
  hundreds of WebSocket riders + REST traffic and reports latency percentiles

## Architecture in one paragraph

Slow-changing data (routes, stops, buses, users) lives in a relational store
behind a layered REST API (`controller → service → repository`) with DTO
validation, a uniform error contract, optimistic locking and Caffeine
caching. Fast-changing data (GPS pings, sessions, rolling speeds) lives in an
in-memory registry that never touches the database — the WebSocket layer is a
thin, JWT-authenticated transport over it. Security is stateless JWT with
role-based rules enforced centrally, plus login rate limiting.

## Run it

Prerequisites: JDK 17+ and Maven.

```bash
mvn spring-boot:run
# → http://localhost:8081
```

Run the tests:

```bash
mvn test
```

### Demo accounts (seeded on first boot)

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Drivers | `driver1` … `driver5` | `password123` |

### Production configuration

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | HMAC signing key (≥ 32 bytes; startup fails on weak keys) |
| `app.cors.allowed-origins` | Lock CORS down from the `*` dev default |
| `spring.datasource.url` | Point at PostgreSQL instead of H2 |

## API at a glance

```
POST   /api/v1/auth/login              credentials → JWT (rate-limited)
GET    /api/v1/auth/me                 current account
GET    /api/v1/routes                  route network (public, cached)
POST/PUT/DELETE /api/v1/routes...      route CRUD              [ADMIN]
GET    /api/v1/buses?page=&size=       fleet, paginated, live state merged
GET    /api/v1/buses/live              buses broadcasting now
GET    /api/v1/buses/code/{c}/history  recent GPS trace
POST/PUT/DELETE /api/v1/buses...       fleet CRUD              [ADMIN]
GET    /api/v1/journeys?fromLat=..     fastest door-to-door plan (Dijkstra)
GET    /api/v1/alerts                  live service alerts (public, 30s cache)
GET    /api/v1/alerts/all              every alert              [ADMIN]
POST/PUT/DELETE /api/v1/alerts...      alert CRUD               [ADMIN]
```

Errors always come back in one shape (`status`, `error`, `message`, `path`,
optional `fieldErrors[]`).

## Project layout

```
src/main/java/com/citybus/
├── config/        Security, WebSocket, OpenAPI, data seeding
├── controller/    REST endpoints (/api/v1)
├── domain/        JPA entities (Route, Stop, Bus, UserAccount)
├── dto/           Request/response records + validation
├── exception/     Typed exceptions + global handler (ApiError contract)
├── repository/    Spring Data repositories
├── security/      JwtService, auth filter, login rate limiter
├── service/       Business logic + LiveTrackingService (in-memory hot path)
└── websocket/     Thin WS transport over LiveTrackingService
src/main/resources/static/   rider, driver and admin single-page frontends
src/test/java/               unit + slice + integration tests
```
