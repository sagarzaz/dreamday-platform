/**
 * DreamDay Platform — Environment Configuration & Validation.
 *
 * PRODUCTION HARDENING:
 * - Validates all required env variables at startup (fail-fast).
 * - Parses numeric values safely to prevent NaN propagation.
 * - Throws descriptive errors if validation fails; prevents silent misconfiguration.
 *
 * WHY fail-fast is critical in serverless:
 * - A misconfigured instance in prod will accept traffic and fail mid-request.
 * - By throwing at module load, we catch config issues during deployment,
 *   not after traffic is routed to the instance.
 * - Vercel health checks can catch this before instances go live.
 *
 * WHY environment-driven configuration:
 * - No hardcoded secrets, feature flags, or deployment-specific logic.
 * - Enables same container image to run in dev, staging, and prod with different env.
 * - Supports ad-hoc changes without rebuild or redeploy (e.g., changing rate limit).
 */

export interface Config {
  // Core identity
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Rate limiter behaviour when redis is down
  rateLimitFailOpen: boolean;

  // Database
  databaseUrl: string;

  // JWT secrets (required in production)
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;

  // Redis for distributed rate limiting, caching, refresh token revocation
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;

  // Rate limiting (requests per window)
  // Sliding window (second-based) implementation in Redis
  loginRateLimit: number;     // max login attempts per IP per window
  loginRateLimitWindow: number; // window in milliseconds
  bookingRateLimit: number;   // max bookings per user per window
  bookingRateLimitWindow: number; // window in milliseconds

  // Server
  port: number;
  bodySizeLimit: string;

  // CORS
  corsOrigins: string[];

  // Optional: enable HSTS in production (strict transport security)
  hstsMaxAge: number; // seconds

  // Graceful shutdown
  shutdownTimeoutMs: number; // max time to wait for in-flight requests
}

function parseNumberEnv(name: string, defaultValue?: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`${name} is required but not set`);
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`${name}="${raw}" is not a valid integer`);
  }
  return parsed;
}

function parseStringEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`${name} is required but not set`);
  }
  return value;
}

function parseStringArrayEnv(name: string, defaultValue?: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    if (defaultValue) return defaultValue;
    throw new Error(`${name} is required but not set`);
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates and parses environment configuration at startup.
 * Throws immediately if any required value is invalid or missing.
 */
export function loadConfig(): Config {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';

  // In test environments we don't want strict validation (no real secrets/DB).
  // Provide reasonable defaults so unit tests can import config without setting a bunch
  // of environment variables and without the process exiting unexpectedly.
  if (nodeEnv === 'test') {
    return {
      nodeEnv,
      logLevel: 'debug',
      databaseUrl: process.env.DATABASE_URL || 'file:memory:?cache=shared',
      jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'test-access-secret',
      jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'test-refresh-secret',
      jwtAccessExpiry: process.env.JWT_ACCESS_EXP ?? '15m',
      jwtRefreshExpiry: process.env.JWT_REFRESH_EXP ?? '7d',
      upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || '',
      upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
      loginRateLimit: parseNumberEnv('LOGIN_RATE_LIMIT', 5),
      loginRateLimitWindow: parseNumberEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      bookingRateLimit: parseNumberEnv('BOOKING_RATE_LIMIT', 10),
      bookingRateLimitWindow: parseNumberEnv('BOOKING_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000),
      rateLimitFailOpen: false,
      port: parseNumberEnv('PORT', 3000),
      bodySizeLimit: process.env.BODY_SIZE_LIMIT || '256kb',
      corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
        : ['http://localhost:3000'],
      hstsMaxAge: parseNumberEnv('HSTS_MAX_AGE', 0),
      shutdownTimeoutMs: parseNumberEnv('SHUTDOWN_TIMEOUT_MS', 30000),
    };
  }

  // DATABASE_URL is provided by hosting platform (Vercel, Railway, etc.)
  // If missing locally, it should be in .env loaded by dotenv
  const databaseUrl = parseStringEnv('DATABASE_URL');

  // JWT secrets: mandatory in production
  const jwtAccessSecret = parseStringEnv('JWT_ACCESS_SECRET');
  const jwtRefreshSecret = parseStringEnv('JWT_REFRESH_SECRET');

  // Verify secrets are not defaults in production
  if (nodeEnv === 'production') {
    if (
      jwtAccessSecret === 'change-me-access' ||
      jwtRefreshSecret === 'change-me-refresh'
    ) {
      throw new Error(
        'JWT secrets cannot be default values in production. ' +
        'Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to cryptographically secure values.'
      );
    }
    // Minimum entropy check: secrets should be at least 32 characters
    if (jwtAccessSecret.length < 32 || jwtRefreshSecret.length < 32) {
      throw new Error(
        'JWT secrets must be at least 32 characters for sufficient entropy.'
      );
    }
  }

  // Redis configuration (Upstash or self-managed)
  const upstashRedisRestUrl = parseStringEnv('UPSTASH_REDIS_REST_URL');
  const upstashRedisRestToken = parseStringEnv('UPSTASH_REDIS_REST_TOKEN');

  // Rate limiting configuration (environment-driven)
  const loginRateLimit = parseNumberEnv('LOGIN_RATE_LIMIT', 5);       // 5 attempts
  const loginRateLimitWindow = parseNumberEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000); // 15 min
  const bookingRateLimit = parseNumberEnv('BOOKING_RATE_LIMIT', 10);   // 10 bookings
  const bookingRateLimitWindow = parseNumberEnv('BOOKING_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000); // 1 hour
  const rateLimitFailOpen = process.env.RATE_LIMIT_FAIL_OPEN === 'true'; // optional, default false

  // Server configuration
  const port = parseNumberEnv('PORT', 3000);
  const bodySizeLimit = parseStringEnv('BODY_SIZE_LIMIT', '256kb');
  const logLevel = (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';

  // CORS origins (comma-separated)
  // In production, explicitly list allowed origins (never use "*" with credentials)
  const corsOrigins = nodeEnv === 'production'
    ? parseStringArrayEnv('CORS_ORIGINS') // required in prod
    : parseStringArrayEnv('CORS_ORIGINS', ['http://localhost:3000', 'http://localhost:3001']);

  // HSTS (HTTP Strict Transport Security): only in production over HTTPS
  const hstsMaxAge = parseNumberEnv('HSTS_MAX_AGE', 31536000); // 1 year

  // Graceful shutdown timeout
  const shutdownTimeoutMs = parseNumberEnv('SHUTDOWN_TIMEOUT_MS', 30000); // 30 seconds

  return {
    nodeEnv,
    logLevel,
    databaseUrl,
    jwtAccessSecret,
    jwtRefreshSecret,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXP ?? '15m',
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXP ?? '7d',
    upstashRedisRestUrl,
    upstashRedisRestToken,
    loginRateLimit,
    loginRateLimitWindow,
    bookingRateLimit,
    bookingRateLimitWindow,
    rateLimitFailOpen,
    port,
    bodySizeLimit,
    corsOrigins,
    hstsMaxAge,
    shutdownTimeoutMs,
  };
}

/**
 * Singleton instance: loaded once at startup.
 * All modules import from this single instance to avoid re-parsing.
 */
export let config: Config;

import { logger, initLogger } from './logger';

try {
  config = loadConfig();
  // configure logger level based on environment
  initLogger(config.logLevel);
  logger.info(`[CONFIG] Loaded configuration for NODE_ENV=${config.nodeEnv}`);
} catch (err) {
  // logger may not be initialized fully, but we still attempt to log
  logger.error('[CONFIG] Failed to load configuration:', { error: String(err) });
  process.exit(1); // Fail fast: don't continue if config is invalid
}
