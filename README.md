# DreamDay Platform — Smart Event Logistics System

A production-grade, serverless fullstack foundation for a smart event hall booking and logistics platform.

This project is designed to demonstrate real-world backend engineering discipline, including:

- Concurrency-safe booking (DB-level unique constraints)
- Distributed Redis rate limiting
- JWT authentication with refresh-token revocation
- Serverless Next.js App Router architecture
- Structured error handling
- Centralized configuration & fail-fast validation
- Production documentation and OpenAPI specification

> Current status: **Backend v1.0.0 — Locked & Production-Ready**
> Frontend integration in progress.

---

## 🏗 Architecture Overview

### Backend Stack

- **Next.js 14 App Router (Serverless Route Handlers)**
- **Prisma ORM**
- **PostgreSQL (Neon-compatible)**
- **Upstash Redis (distributed rate limiting + token revocation)**
- **Custom JWT authentication**
- **Strict TypeScript**

### Design Principles

- No in-memory state (fully serverless-safe)
- Database-enforced concurrency
- Distributed rate limiting
- Standardized API response envelope
- Fail-fast environment validation
- Structured JSON logging with PII redaction
- Clear migration path to dedicated Node backend if needed

---

## 🔐 Core Engineering Features

### 1️⃣ Concurrency-Safe Booking

- Composite unique constraint on `(eventHallId, eventDate)`
- Prisma transaction enforcement
- Graceful conflict handling (409)
- Audit-friendly error mapping

Prevents double-booking even under concurrent requests.

---

### 2️⃣ Distributed Rate Limiting

- Upstash Redis sliding-window strategy
- IP-based login throttling
- User-based booking throttling
- Configurable via environment variables
- No in-memory limits (horizontal scaling safe)

---

### 3️⃣ JWT Authentication (Access + Refresh)

- Access token verification
- Refresh token with Redis revocation store
- Role-based authorization
- No token data leakage
- Strict expiration validation

---

### 4️⃣ Serverless Architecture

- Pure Next.js route handlers (`/app/api/v1/*`)
- No Express
- Stateless design
- Prisma singleton pattern
- Redis singleton pattern
- Compatible with Vercel deployment

---

### 5️⃣ Standardized API Responses

All responses follow:

```json
{
  "success": true | false,
  "data": {},
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
