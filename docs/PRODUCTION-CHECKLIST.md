# Production Checklist — DreamDay Backend

This checklist maps directly to implemented features in the codebase. Use it to perform pre-release verification and runbook checks.

**Security**

- **JWT secrets configured and strong:** verify `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are set and >=32 chars (enforced by [src/lib/config.ts](src/lib/config.ts)).
- **Refresh-token revocation:** refresh tokens are tracked via a Redis-backed store (`src/auth/redis-refresh-store.ts`) to allow server-side revocation.
- **Token type discrimination:** tokens contain `type` and verification functions enforce token type (`src/lib/auth.ts`, `src/auth/tokens.ts`).
- **Least-privilege CORS:** `CORS_ORIGINS` must be explicitly set in production; `middleware.ts` applies CORS/security headers.
- **PII minimization in logs:** structured logger redacts PII (see `src/lib/logger.ts`) — verify no raw `console.log` remains in production code.

**Reliability**

- **Fail-fast configuration:** `src/lib/config.ts` validates required environment variables at startup and exits on misconfiguration.
- **Health & readiness endpoints:** `/api/v1/health` and `/api/v1/ready` exist for K8s/Vercel probes; verify readiness returns 200 after DB migrations.
- **DB migrations applied:** ensure `npx prisma migrate deploy` ran before traffic is routed (see `DEPLOYMENT.md`).
- **Centralized error mapping:** runtime errors are mapped in `src/lib/error.ts` to stable error codes for predictable client behavior.

**Scalability**

- **Prisma singleton:** `src/lib/prisma.ts` exposes a single `PrismaClient` instance per runtime to avoid repeated construction and reduce overhead.
- **Serverless-friendly Redis:** Upstash REST is used for sliding-window rate limiting and token revocation (`src/lib/rateLimit.ts`, `src/auth/redis-refresh-store.ts`) to avoid TCP connection churn.
- **Rate limiting implemented:** login and booking rate-limits are implemented via Redis sliding-window; verify `LOGIN_RATE_LIMIT` & `BOOKING_RATE_LIMIT` values meet traffic needs.
- **Booking concurrency safety:** booking orchestration is concurrency-aware (`src/services/BookingOrchestrationService.ts`), and Prisma unique constraints plus application-level checks prevent double-bookings.

**Observability**

- **Structured logging:** `src/lib/logger.ts` emits structured JSON logs with `requestId` propagation (via `middleware.ts`). Confirm log ingestion pipeline (e.g., Logflare, Datadog) is configured to parse JSON.
- **Error codes & mapping:** all domain errors map to explicit codes (see `src/errors` and `src/lib/error.ts`) so monitoring can alert on particular error codes (e.g., `BOOKING_CONFLICT`, `TOKEN_EXPIRED`).
- **Metrics to collect:** request latency, 4xx/5xx rates, DB connection count, Upstash 429/5xx rates, refresh-token revocation counts.

**Maintainability**

- **API surface documented:** OpenAPI spec committed at `docs/openapi.yaml` describing `/api/v1` operations and schemas.
- **Unit tests present and passing:** Jest tests cover `BookingOrchestrationService` and authentication flows. Run `npm test` to verify.
- **Fail-fast configuration:** repeated — this prevents hidden runtime surprises and makes environments reproducible.
- **Centralized services:** `src/lib/services.ts` wires singleton stores and services (Redis refresh store, booking service) making future replacement easier.

## Pre-Release Checklist (run these before flipping Production DNS)
1. Run `npm ci && npm run build` locally or in CI; confirm `prisma generate` completes without error.
2. Run `npx prisma migrate deploy` against production database.
3. Verify environment variables in Vercel match those in `DEPLOYMENT.md`.
4. Smoke test:
   - `GET /api/v1/health` should return 200
   - `GET /api/v1/ready` should return 200
   - Login flow: `POST /api/v1/auth/login` with valid credentials returns `tokens` and `user` envelope
   - Refresh flow: `POST /api/v1/auth/refresh` returns new tokens and invalidates old refresh token
5. Rate-limit verification: trigger login rate limit with multiple failed attempts and verify 429/blocked behavior (observe logs for rate-limit events).
6. Booking concurrency test: use a small load test to attempt concurrent bookings to the same hall/date and confirm only one booking succeeds and others receive `BOOKING_CONFLICT`.
7. Observability: verify logs are received by your logging service and contain `requestId` and structured JSON fields.

## Runbook: Common Incidents
- Database connectivity failure: check `DATABASE_URL`, run `prisma migrate status`, scale DB.
- Redis (Upstash) 429s: check Upstash usage, scale plan, or tune rate limits.
- Token revocation issues: check Redis keys used by `redis-refresh-store` and ensure TTLs match refresh expiry.

## Notes and Non-Implemented Items
- This checklist intentionally omits generic items not present in this codebase (e.g., multi-region DB replicas). All items above map to implemented code paths.

---
Keep this file updated with operational playbooks and runbooks as you iterate on infra.
