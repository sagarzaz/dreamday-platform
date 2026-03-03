# DreamDay Platform — Architectural Review

**Purpose:** Design tradeoffs, bottlenecks, performance limits, security considerations, and production hardening recommendations. For senior engineers.

---

## Design Tradeoffs

| Decision | Tradeoff | Rationale |
|----------|----------|------------|
| **Global response envelope** `{ success, data \| error }` | All responses share one shape; clients must check `success`. | Predictable error handling and logging; no leaking of stack or internal messages. |
| **JWT access + refresh** | Stateless access tokens can’t be revoked until expiry; refresh stored server-side. | Horizontal scaling without shared session store; revocation via refresh token invalidation. |
| **Optimistic booking (try insert, catch P2002)** | No “lock” or “reserve then confirm”; conflict is normal under contention. | Simpler than distributed locks; DB is single source of truth; 409 is a clear client signal. |
| **Hall cache TTL 5 min** | Stale listing data for up to 5 min after hall update. | Booking always hits DB; cache is for discovery only; 5 min balances freshness vs load. |
| **In-memory rate limit** | Per-instance limits; aggressive clients can spread across instances. | Fast to ship; replace with Redis-backed limit for production multi-instance. |
| **WebSocket in-process** | Notifications only to clients connected to the same instance. | Add Redis Pub/Sub so all instances forward to their connected clients. |
| **Soft delete (deletedAt)** on PlatformUser, EventHall, VendorService | Queries must filter `deletedAt: null`; no hard delete of referenced data. | Audit and referential integrity; EventBooking is not soft-deleted so uniqueness is strict. |

---

## Bottlenecks

1. **PostgreSQL write path:** Booking creation and audit write in one transaction. Under very high TPS, the primary DB becomes the bottleneck. Mitigation: ensure indexes (eventHallId+eventDate unique, booking status, etc.); consider async audit write (eventual consistency) if audit volume grows.
2. **Single Prisma client:** Connection pool is shared. Size the pool (e.g. `connection_limit` in DATABASE_URL) to match instance count and max concurrent requests.
3. **Redis (when used):** Single Redis for cache + refresh store. Use connection pooling (e.g. ioredis) and, at scale, Redis Cluster or a managed service.
4. **WebSocket:** Each connection is a long-lived socket. With many concurrent users, memory and file descriptors per process matter; consider a dedicated gateway process and horizontal scaling with Redis Pub/Sub.

---

## Performance Limits

- **Booking:** Throughput limited by DB transaction rate and unique constraint check. Expect hundreds of bookings/sec on a single primary with proper indexing; scale with read replicas for reads only.
- **Hall discovery:** Cache reduces DB load; cache hit rate depends on key diversity. Without cache, list endpoint is bounded by Prisma + PostgreSQL query time (index on district, capacity).
- **Auth:** Login is CPU-bound (bcrypt compare); use appropriate cost factor. JWT sign/verify is cheap. Refresh token lookup is O(1) in Redis.
- **Rate limits:** Intentionally limit login (e.g. 10/15 min per IP) and booking (e.g. 20/min per user) to cap abuse; adjust for product needs.

---

## Security Considerations

- **Passwords:** Bcrypt with cost 12; never log or expose plaintext.
- **JWT:** Access token short-lived (e.g. 15 min); refresh in Redis with TTL. Use strong secrets (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET) and rotate periodically. Validate `sub`, `role`, and expiry on every protected route.
- **Input:** Zod validates shape and type; sanitize for injection (Prisma parameterizes queries). No raw SQL with user input.
- **Rate limiting:** Login rate limit by IP reduces brute-force; booking rate limit by userId reduces abuse. Add CAPTCHA or account lock after N failures if needed.
- **CORS:** Restrict origin in production; do not use `*` for credentials.
- **Headers:** Helmet (or equivalent) for X-Content-Type-Options, X-Frame-Options, etc. Consider adding in production.
- **Secrets:** All secrets in env (or secret manager); never in code or logs.

---

## Production Hardening Recommendations

1. **Secrets & env:** Use a secret manager (e.g. AWS Secrets Manager, Vault); set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, REDIS_URL. Use different secrets per environment.
2. **Database:** Enable SSL for Prisma; use connection pooling (e.g. PgBouncer) if needed. Backups and point-in-time recovery configured.
3. **Redis:** Use Redis with TLS and auth in production; key prefix (e.g. `dreamday:`) to avoid collisions.
4. **Rate limiting:** Replace in-memory store with Redis so limits apply across instances. Consider per-route limits (stricter for login, moderate for booking).
5. **Logging:** Send structured logs to an aggregator (e.g. ELK, Datadog). Avoid logging PII (passwords, tokens); log requestId, userId (or hash), and error codes.
6. **Monitoring:** Metrics for request count, latency, error rate, and booking conflict rate. Alerts on 5xx spike and auth failures.
7. **WebSocket scaling:** Implement Redis Pub/Sub for booking_created and booking_confirmed so every instance can push to its connected clients.
8. **Health checks:** `/health` (and optionally `/ready` with DB/Redis check) for load balancer and orchestrator.
9. **API versioning:** Keep `/api/v1`; introduce v2 when breaking changes are required; maintain v1 for a deprecation period.
10. **Dependency and supply chain:** Regular updates; audit for known vulnerabilities (npm audit, Snyk). Pin major versions and review minor/patch.

---

## Why Standardized Errors Improve API Reliability

- **Clients** can depend on a single envelope and error shape; no parsing of HTML or free-form strings.
- **Error codes** (`BOOKING_CONFLICT`, `VALIDATION_FAILED`, etc.) enable i18n and consistent UX (e.g. “This date is no longer available”).
- **HTTP status + code** allow load balancers and proxies to treat 4xx vs 5xx differently (retry or not).
- **Logging and alerting** can key off codes and requestId for debugging and SLA monitoring.

---

## Why Validation Must Occur Before Business Logic

- **Fail fast:** Invalid input is rejected at the edge with 422 and a clear message; services receive only typed, bounded data.
- **Security:** Prevents malformed or oversized payloads and injection from reaching Prisma or Redis.
- **Single contract:** Zod (or equivalent) is the source of truth for request shape; OpenAPI/docs can be derived from it.
- **Stable behavior:** Business logic does not have to defensively handle missing or wrong types; it simplifies services and reduces bugs.

---

## Why DB-Level Constraints Prevent Race Conditions

- Two concurrent requests can both pass “hall exists and capacity OK” and then attempt INSERT. Only one can satisfy the unique constraint `(eventHallId, eventDate)`; the other receives P2002. The database serializes the constraint check and insert, so no double booking is possible regardless of application concurrency.

---

## Why Optimistic Concurrency Is Safer Than Frontend-Only Validation

- The frontend cannot guarantee that another user has not booked the same slot between “check availability” and “submit.” Only the database can enforce “at most one row per (hall, date)” under concurrency. Optimistic “try insert, catch conflict” uses the DB as the single source of truth and avoids distributed locks.

---

## Behavior Under High Concurrency Load

- Many clients may request the same hall+date; one succeeds (201), the rest get 409 (BOOKING_CONFLICT). This is correct. Clients can show “date taken” and suggest alternatives. Rate limiting (per user) prevents a single client from flooding the endpoint. DB and connection pool should be sized for expected peak TPS.

---

## JWT vs Session-Based Auth: Security Tradeoffs

| Aspect | JWT (as implemented) | Session-based |
|--------|------------------------|---------------|
| **Revocation** | Access token valid until expiry unless refresh is revoked. | Immediate: delete session. |
| **Storage** | Server stores only refresh token (e.g. Redis). | Server stores session (Redis/DB). |
| **Scaling** | Stateless; no session lookup per request. | Requires shared session store (Redis) for multi-instance. |
| **Secrets** | Signing secret must be protected; rotation invalidates all tokens until refresh. | Session ID is opaque; server-side data is authoritative. |

We use JWT for scalability and to avoid a session store on every request; refresh token store (Redis) allows revocation and limits exposure of long-lived tokens.

---

## Caching Scalability Impact

- **Positive:** Hall discovery cache reduces DB load and latency for repeated similar queries. With Redis shared across instances, cache hit rate improves with traffic.
- **Risk:** Stale data (up to TTL) after hall updates; mitigated by invalidation on update and by never using cache for booking availability decisions.
- **Key design:** Cache key includes (district, minCapacity, maxBudget, limit, offset) so different filters don’t collide; TTL 5 min keeps memory bounded.

---

## Why WebSocket Chosen Over Polling

- **Latency:** Notifications (e.g. “booking confirmed”) reach the client as soon as the server pushes; no poll interval delay.
- **Efficiency:** One persistent connection instead of many repeated GETs; less overhead and fewer 304s.
- **UX:** Real-time updates without page refresh. Polling can be added as fallback when WebSocket is unavailable.

---

## Horizontal Scaling Challenges (WebSocket)

- Connections are tied to the process that accepted them. With multiple instances, a client connected to instance A will not receive events emitted only on instance B. **Solution:** Redis Pub/Sub. The instance that creates the booking publishes `booking:created`; every instance subscribes and forwards to its connected admin sockets. Same for `booking_confirmed` to the customer’s socket (instance must know which instance has that customer’s connection, or broadcast and let clients ignore irrelevant messages).

---

## Abuse Prevention Strategy

- **Login:** Rate limit by IP (e.g. 10/15 min) to throttle brute-force; return generic “Invalid email or password” to avoid user enumeration. Optional: account lock or CAPTCHA after N failures.
- **Booking:** Rate limit by userId (e.g. 20/min) to prevent one account from flooding the API; DB constraint prevents double booking.
- **Global:** Optional global rate limit per IP (e.g. 100/min) to cap abuse from a single origin. Use Redis for cross-instance limits.

---

## Why Concurrency Testing Is Critical

- Double booking is a core integrity failure. Concurrency tests (e.g. N concurrent createBooking for same hall+date) verify that only one succeeds and the rest receive ConflictError, and that the DB never stores two bookings for the same hall+date. Without this, regressions (e.g. removing the unique constraint or mis-handling P2002) could ship. Tests should run in CI; with a test DB, use real Prisma; without, use mocks that simulate P2002 for concurrent calls.
