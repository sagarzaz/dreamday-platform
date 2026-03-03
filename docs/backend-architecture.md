# DreamDay Platform — Backend Architecture

**Audience:** Senior engineers. This document describes the production-grade backend for the Smart Event Logistics System.

---

## 1. System Overview

The backend is a **monolithic Node.js service** (Express, Prisma, PostgreSQL, Redis, JWT, WebSockets) with clear boundaries: domain errors, validated input, concurrency-safe booking, role-based auth, caching, and real-time notifications. It is designed for **reliability first**: DB constraints enforce invariants; application logic validates and orchestrates; caching and WebSockets are additive.

**Stack:**
- **Runtime:** Node.js
- **API:** Express, versioned under `/api/v1`
- **Data:** PostgreSQL via Prisma ORM
- **Cache:** Redis (hall discovery, optional refresh-token store)
- **Auth:** JWT (access + refresh), bcrypt password hashing
- **Real-time:** WebSocket (BookingNotificationGateway)

**Design principles:**
- Domain-driven naming (PlatformUser, EventBooking, EventHall, etc.)
- Single global API response envelope: `{ success, data? | error? }`
- Validation at the edge (Zod); business rules in services
- Double-booking prevented by DB unique constraint; application handles conflict and audit

---

## 2. Data Flow

```
Client → [Rate limit] → [Request ID] → [Auth when required] → [Validate] → Handler
  → Service (Prisma / Redis / Gateway)
  → Response envelope (success + data | error)
  → [Error handler] → JSON error envelope + status
```

- **Request ID** is set per request (or taken from `X-Request-Id`) and used in logs and error responses.
- **Auth** resolves JWT to `userId`, `email`, `role` and attaches to `res.locals`.
- **Validation** (Zod) parses body/query and returns 422 with a structured error before any business logic.
- **Handlers** call services and return `{ success: true, data }` with appropriate HTTP status (201 for create, 200 for read).
- **Error handler** catches DomainError, Prisma P2002 (unique), Zod, and unknown errors; maps to status and `{ success: false, error: { code, message } }`.

---

## 3. Booking Lifecycle

1. **Create booking (POST /api/v1/bookings)**  
   - Input validated (eventHallId, eventDate, guestCount, totalAmount).  
   - `BookingOrchestrationService.createBooking`:  
     - Load hall; reject if missing, inactive, or soft-deleted.  
     - Reject if guestCount > hall.capacity.  
     - In a Prisma transaction: `eventBooking.create` (status DRAFT) + `auditTrail.create` (CREATED).  
   - If Prisma throws **P2002** (unique on eventHallId + eventDate):  
     - Record conflict attempt in AuditTrail (metadata: event, reason, hall, date).  
     - Throw `ConflictError(BOOKING_CONFLICT)` → 409 and standard error envelope.  
   - On success: optional WebSocket notification to admins (`booking_created`).

2. **Status transitions**  
   - Modeled by `EventBookingStatus` enum and `EventBookingStatusTransitionRule` + `EventBookingStatusChange` ledger.  
   - Transition rules are data-driven; ledger entries reference allowed (fromStatus, toStatus) via FK.  
   - For full enforcement, a DB trigger can reject direct updates to `EventBooking.bookingStatus` that don’t match the ledger.

3. **Confirmation**  
   - When booking moves to CONFIRMED (e.g. after payment), `BookingNotificationGateway.notifyUser(customerId, { kind: 'booking_confirmed', bookingId })` can be used to push to the customer.

---

## 4. Concurrency Strategy

- **Single source of truth:** The unique constraint `(eventHallId, eventDate)` on `EventBooking` guarantees at most one booking per hall per date. No application-level lock is required.
- **Optimistic flow:** Validate hall and capacity, then attempt insert. The first commit wins; concurrent requests get P2002 and are turned into `ConflictError` with an audit record of the attempt.
- **Why not frontend-only validation:** Another user can book the same slot between “check” and “submit”; only the DB can enforce exclusivity under concurrency.
- **High concurrency:** Under load, many requests may receive 409 for the same slot. This is correct behavior; clients can retry with another date or hall. Rate limiting (per user) prevents a single client from flooding the booking endpoint.

---

## 5. Caching Strategy

- **Hall discovery** (`HallDiscoveryCachingLayer`):  
  - Key: (district, minCapacity, maxBudget, limit, offset).  
  - TTL: 5 minutes.  
  - Invalidation: call `invalidateAll()` when an EventHall is updated (price, active, deleted) so listing caches don’t serve stale data.
- **Stale risk:** Up to 5 minutes, clients may see old hall data in list endpoints. Booking creation always reads from DB, so availability is never decided from cache alone.
- **Refresh tokens:** Can be stored in Redis (key = JTI, value = userId, TTL = token lifetime) for revocation and multi-instance consistency.

---

## 6. Observability Strategy

- **Structured logging** (JSON): level, message, timestamp, requestId, userId, and other context. Log levels: info (flow), warn (recoverable, e.g. 4xx), error (5xx, unexpected).
- **Request ID:** Propagated in response header and logs for tracing.
- **Errors:** Domain errors and P2002 are logged with code and context; unknown errors are logged with message/name (no stack to client).
- **Metrics:** Not implemented in-code; recommend adding request duration, status counts, and booking conflict rate (e.g. Prometheus + middleware).

---

## 7. Failure Handling

- **DB down:** Prisma calls throw; error handler returns 500 and generic message; no stack to client.
- **Redis down:** If Redis is used for cache or refresh store, degrade: skip cache (or use in-memory fallback for refresh) so core booking and auth still work.
- **WebSocket:** If the gateway is down, booking and confirmation still succeed; only real-time push is affected. Clients can poll or refresh.
- **Rate limit:** 429 with `RATE_LIMIT_EXCEEDED`; clients should back off and respect Retry-After if added.

---

## 8. Scaling Plan

- **Vertical:** Increase Node memory/CPU and PostgreSQL connection pool as needed.
- **Horizontal:**  
  - Stateless API: run multiple instances behind a load balancer.  
  - **Sticky sessions not required** for REST; JWT is stateless.  
  - **WebSocket:** Connections are per-instance. Use Redis Pub/Sub: publisher (instance that created booking) publishes `booking:created`; all instances subscribe and forward to their connected admin sockets. Same for `booking_confirmed` to customer sockets.  
  - **Rate limiting:** Move from in-memory to Redis so limits are shared across instances.  
  - **Refresh tokens:** Store in Redis so any instance can validate and revoke.
- **Database:** Read replicas for hall discovery and list endpoints; write to primary for booking and auth. Prisma read replica support can be used when available.

---

## 9. Future Microservice Extraction Plan

- **Booking service:** Extract `BookingOrchestrationService` + Prisma booking/audit models into a dedicated service. API gateway or BFF calls it via HTTP/gRPC; it owns the unique constraint and audit.
- **Auth service:** Extract login, refresh, and token issuance; other services validate JWT (shared secret or JWKS). User and session data live in the auth service or a shared DB.
- **Hall discovery service:** Read-only API + Redis cache; subscribed to hall update events (e.g. message queue) for cache invalidation.
- **Notifications:** Dedicated WebSocket/SSE service subscribing to Redis (or queue) for booking_created / booking_confirmed and maintaining client connections.
- **Data consistency:** Use events (e.g. “BookingCreated”) for cross-service audit and analytics; critical invariants (e.g. double booking) stay in the service that owns the write (booking).

---

*Document version: 1.0. Audience: senior engineers. For design tradeoffs, bottlenecks, and hardening, see the Architectural Review section in the project handover.*
