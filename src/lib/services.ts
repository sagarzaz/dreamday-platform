/**
 * Convenience singletons for service layer objects used by route handlers.
 *
 * In a serverless environment, modules are cached between invocations within
 * the same execution context, so creating a singleton here avoids re-creating
 * services (and their Prisma client dependency) on every request.
 */

import { prisma } from './prisma';
import { redisRefreshStore } from '../auth/redis-refresh-store';
import { LoginService } from '../auth/login-service';
import { BookingOrchestrationService } from '../services/BookingOrchestrationService';
import { HallDiscoveryCachingLayer } from '../cache/HallDiscoveryCachingLayer';

// the login service uses an in-memory refresh store by default; production
// could replace this with a Redis-backed implementation (see auth/refresh-store).
export const loginService = new LoginService(prisma, redisRefreshStore);

// booking orchestration service is stateless aside from Prisma
export const bookingService = new BookingOrchestrationService(prisma);

// hall cache is optional; we instantiate null for now. A real Redis-based
// client can be wired up in Phase 6 when we create a global Redis singleton.
export const hallCache: HallDiscoveryCachingLayer | null = null;
