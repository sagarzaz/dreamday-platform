# Deployment Guide — DreamDay Backend

This document describes the exact deployment steps and environment required to run the DreamDay serverless backend in production (Next.js App Router serverless route handlers under `/app/api/v1`). It assumes Prisma (Postgres), Upstash Redis (REST), and Vercel hosting. Follow the steps exactly and store secrets in a secure provider (Vercel Environment Variables, Vault, etc.).

## Required Environment Variables
These names are used by the running code (`src/lib/config.ts`). All variables are required in production unless noted.

- `NODE_ENV` — `production` (set by platform)
- `DATABASE_URL` — Prisma-compatible Postgres connection string (Neon or other provider)
- `JWT_ACCESS_SECRET` — 32+ char secret for signing access tokens
- `JWT_REFRESH_SECRET` — 32+ char secret for signing refresh tokens
- `JWT_ACCESS_EXP` — optional, default `15m` (access token lifetime)
- `JWT_REFRESH_EXP` — optional, default `7d` (refresh token lifetime)
- `UPSTASH_REDIS_REST_URL` — Upstash REST endpoint URL
- `UPSTASH_REDIS_REST_TOKEN` — Upstash REST token (secret)
- `LOGIN_RATE_LIMIT` — integer (e.g., `5`) — max login attempts per IP per window
- `LOGIN_RATE_LIMIT_WINDOW_MS` — integer (milliseconds) — e.g., `900000` (15 minutes)
- `BOOKING_RATE_LIMIT` — integer (e.g., `10`) — max booking requests per user per window
- `BOOKING_RATE_LIMIT_WINDOW_MS` — integer (milliseconds) — e.g., `3600000` (1 hour)
- `PORT` — optional (platform usually supplies this)
- `BODY_SIZE_LIMIT` — e.g., `256kb`
- `CORS_ORIGINS` — comma-separated allowed origins (required in production)
- `HSTS_MAX_AGE` — integer seconds for HSTS (recommended `31536000`)
- `SHUTDOWN_TIMEOUT_MS` — graceful shutdown timeout in ms (default `30000`)
- `LOG_LEVEL` — `info`/`debug`/`warn`/`error` (optional)

## Example `.env` template
Create a `.env` for staging or local testing. NEVER check production secrets into source control.

```
# .env (example)
NODE_ENV=production
DATABASE_URL=postgresql://user:password@db-host:5432/dreamday?schema=public
JWT_ACCESS_SECRET=replace-with-32-plus-random-characters
JWT_REFRESH_SECRET=replace-with-32-plus-random-characters
JWT_ACCESS_EXP=15m
JWT_REFRESH_EXP=7d
UPSTASH_REDIS_REST_URL=https://us1-prod-upstash.redis.example
UPSTASH_REDIS_REST_TOKEN=upstash_token_here
LOGIN_RATE_LIMIT=5
LOGIN_RATE_LIMIT_WINDOW_MS=900000
BOOKING_RATE_LIMIT=10
BOOKING_RATE_LIMIT_WINDOW_MS=3600000
CORS_ORIGINS=https://app.example.com,https://admin.example.com
HSTS_MAX_AGE=31536000
SHUTDOWN_TIMEOUT_MS=30000
BODY_SIZE_LIMIT=256kb
LOG_LEVEL=info
```

## Neon (Postgres) Setup
1. Create a Neon project (or your Postgres provider). Create a dedicated database for DreamDay.
2. Create a database user with a strong password and restrict network access if possible.
3. Copy the Prisma-compatible connection string (DATABASE_URL) — include credentials and host.
4. In the repo, ensure `prisma/schema.prisma` datasource is configured to `provider = "postgresql"` and that migrations are present.
5. On your CI/build step or locally, run:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy   # apply migrations in production
```

Notes:
- For serverless deployments prefer Neon Serverless or a connection-pooling layer (Neon serverless or PgBouncer) to avoid connection exhaustion.
- Consider Prisma Data Proxy for heavy scale deployments to avoid DB connection limits from short-lived serverless instances.

## Upstash Redis (REST) Setup
The code uses Upstash REST API for sliding-window rate limiting and refresh token revocation.

1. Create an Upstash Redis database and enable REST API access.
2. Copy the REST URL and REST token into `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Verify connectivity from a temporary script using the REST endpoint; the code uses the REST API (no TCP client needed), which is friendly to serverless cold starts.

Operational notes:
- Upstash REST can be rate-limited — if your traffic is bursty, monitor 429 responses and consider using Pro tier for higher throughput.
- Ensure the token is stored securely in the platform environment variables (never in the repo).

## Vercel Environment Configuration
1. In your Vercel project settings, add all environment variables under the appropriate environment (Preview, Production). Use `Environment Variables` UI; values should be the production secrets.
2. Set `NODE_ENV` to `production` for the Production environment (Vercel often sets this automatically on deploy).
3. Build command: `npm run build` (Next.js will run `prisma generate` if you include it in `postinstall` or CI step).
4. Recommended package.json scripts (example):

```json
"scripts": {
  "build": "next build",
  "postinstall": "prisma generate"
}
```

5. Ensure `prisma` and `@prisma/client` are installed as production dependencies (not dev-only) so `prisma generate` runs during build.

## Cold Start Considerations
- Keep heavy synchronous work out of module initialization. The repo follows this pattern: configuration is validated at module load (fail-fast), but connection clients are singletons and lazy-initialized (`src/lib/prisma.ts`, Upstash REST client is lightweight). This minimizes cold-start work.
- Upstash REST client is serverless-friendly (no long-lived TCP connection). This reduces cold-start cost compared to a TCP Redis client.
- To reduce cold starts: increase function memory (on paid plans), deploy on regions close to your users, and opt for Vercel Pro/Enterprise which have higher concurrency and fewer cold starts.

## Prisma Connection Reuse
- The repo exposes a Prisma singleton at [src/lib/prisma.ts](src/lib/prisma.ts). This pattern ensures a single `PrismaClient` instance is reused across invocations within a serverless instance, avoiding repeated client construction.
- In serverless environments, short-lived instances can cause a spike in DB connections. Recommended mitigations:
  - Use Neon serverless or a managed Postgres with serverless-friendly pooling.
  - Use Prisma Data Proxy to reduce direct DB connections from serverless functions.
  - Configure your DB to support the expected max concurrent connections and monitor connection usage.

## Vercel Free Tier — Scaling Limits and Constraints
- The Vercel Hobby (free) tier is intended for development and small demos. Limits change over time; verify the current Vercel docs for exact numeric caps. Common constraints you should expect:
  - Shorter serverless function execution timeouts compared to paid tiers (can impact long-running requests).
  - Lower concurrent function execution quotas and more frequent cold starts under burst traffic.
  - Lower overall throughput on shared infrastructure.

Recommendation: For production usage or portfolio demos with consistent traffic, use Vercel Pro or deploy to a dedicated Node server/VM to avoid cold-starts and connection scaling issues.

## Known Production Constraints
- Serverless function cold starts can affect latency-sensitive endpoints (bookings). Mitigations: use Upstash REST, increase memory, or use Pro plan.
- Prisma direct DB connections from serverless instances can exhaust DB connection limits — use Neon or Prisma Data Proxy.
- Upstash REST throughput limits: monitor, and move to paid plan if throttling occurs.
- Rate limiting is implemented in Redis; if Redis is unavailable, clients may bypass protections. Configure alerting for Redis availability.

## Migration Path to a Dedicated Node Server
If you outgrow serverless or need to eliminate cold-starts and DB connection churn:

1. Create a small Node.js service that imports the same code (you can reuse `src/` files). Replace Next.js route handlers with an Express/Fastify server or keep Next.js for SSR.
2. Keep the same Prisma singleton and Upstash REST usage — they work in Node processes and will benefit from persistent connections.
3. Deploy to a VM or container service (AWS ECS, GCP Cloud Run with concurrency > 1, DigitalOcean App Platform, or similar) and configure horizontal autoscaling.
4. Move Prisma to use a connection pool (pgbouncer) or use a persistent DB connection, avoiding the short-lived connection problem of serverless.

## Deploy Checklist (quick)
1. Verify `DATABASE_URL` points to production DB and migrations applied (`npx prisma migrate deploy`).
2. Set all required env vars in Vercel for Production.
3. Ensure `JWT_*` secrets are strong (>=32 chars).
4. Verify `UPSTASH_REDIS_REST_URL` & token have correct privileges.
5. Run smoke tests against `/api/v1/health` and `/api/v1/ready` after deploy.

## Troubleshooting
- 500s on readiness: check DB migrations and `DATABASE_URL` reachability.
- Rate limiter 429s: check Upstash usage and increase plan or tune rate limits.
- Token errors: ensure JWT secrets match across services and are at least 32 chars.

---
Generated by the repository tooling; keep this file up to date as infra changes.
