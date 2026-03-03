# DreamDay Platform — Smart Event Logistics System

Production-grade backend: concurrency-safe booking (DB unique constraint + audit), Redis caching, JWT auth, WebSocket notifications, versioned API, rate limiting, and structured errors.

## Backend (Next.js 14 App Router Serverless + Prisma)

### Prerequisites
- Node.js 18+
- PostgreSQL
- Redis (optional; used for hall cache and refresh token store)

### Environment
Create `.env` (see `.env.example` if present). Required:
- `DATABASE_URL` — PostgreSQL connection string (used via `prisma.config.ts` in Prisma 7)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — strong random secrets
- `REDIS_URL` — optional; if missing, hall cache is disabled and refresh tokens use in-memory store

### Commands
```bash
npm install
npx prisma generate
npm run dev          # ts-node-dev
npm run build && npm start
npm test
```

### API
- `POST /api/v1/auth/login` — login (rate limited by IP)
- `POST /api/v1/auth/refresh` — refresh tokens
- `POST /api/v1/bookings` — create booking (auth + role CUSTOMER_CLIENT or admin)
- `GET /api/v1/halls?district=&minCapacity=&maxBudget=&limit=&offset=` — list halls (optional cache)
- `GET /api/v1/halls/:id` — get hall by id

### Docs
- `docs/backend-architecture.md` — system overview, data flow, scaling
- `docs/ARCHITECTURAL-REVIEW.md` — tradeoffs, bottlenecks, security, hardening
- `prisma/INDEXING.md` — index and constraint rationale
