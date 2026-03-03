/**
 * DreamDay Platform — Distributed Rate Limiting with Redis.
 *
 * WHY Redis instead of in-memory:
 * - In-memory tracking does not scale: each instance has its own Map; two instances
 *   allow 2× the limit to the same user (horizontal scaling fails).
 * - Redis is distributed: all instances share the same window state, so limits are
 *   truly global and enforced at API level (scalable to any number of instances).
 *
 * ALGORITHM: Sliding window with Redis sorted sets.
 * - Each request timestamp is added to a sorted set for that key.
 * - We remove entries older than the window (timestamp < now - window).
 * - We count remaining entries; if > max, reject.
 * - If accepted, set an expiration so stale keys auto-cleanup.
 *
 * WHY slides window over fixed window:
 * - Fixed window: user can make max requests at second 59, then max again at second 0 (burst).
 * - Sliding window: true rate limit over a rolling period; no burst loophole.
 *
 * LIMITATIONS in production:
 * - Redis latency adds ~5-10ms per request.
 * - In rare cases (Redis down), we fail open (no rate limit) or fail closed (reject all).
 *   Consider fallback behavior based on your SLOs.
 * - Large number of unique keys can consume Redis memory; consider key rotation strategy.
 */

import { config } from './config';
import { logger } from './logger';

/**
 * Rate limit response: indicates if request is allowed and provides headers.
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
}

/**
 * Upstash REST client: minimal implementation for rate limiting.
 * Upstash provides Redis-compatible API over HTTP REST (useful for serverless).
 */
class UpstashRedisClient {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    // Ensure URL has no trailing slash
    this.url = url.endsWith('/') ? url.slice(0, -1) : url;
    this.token = token;
  }

  /**
   * Sends a command to Upstash REST API.
   * Format: POST /multi => [["COMMAND", "arg1", "arg2", ...], ...]
   */
  private async request(commands: Array<string[]>): Promise<unknown[]> {
    try {
      const response = await fetch(`${this.url}/multi`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
      });

      // Upstash returns 200 with result array or error
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      // Result is an array of responses, one per command
      return Array.isArray(result) ? result : [result];
    } catch (err: unknown) {
      const msg = (err as Error).message || String(err);
      logger.error('Upstash Redis error', { error: msg });

      // Return empty data; will be handled by caller (fail open or fail closed)
      throw new Error(`Redis unavailable: ${msg}`);
    }
  }

  /**
   * Executes a sliding window rate limit check.
   * 1. Remove entries older than (now - window)
   * 2. Count remaining entries
   * 3. If count >= max, reject
   * 4. Else add new entry with current timestamp
   * 5. Set expiration to window + grace period
   */
  async checkRateLimit(
    key: string,
    max: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    // All commands execute in a batch
    const commands: Array<string[]> = [
      // Remove old entries outside the window
      ['ZREMRANGEBYSCORE', key, '-inf', String(windowStart)],
      // Count current entries in window
      ['ZCARD', key],
      // Add current request with score = current timestamp
      ['ZADD', key, String(now), `req-${now}-${Math.random()}`],
      // Set expiration to window + grace period
      ['EXPIRE', key, String(Math.ceil(windowMs / 1000) + 60)],
    ];

    const [, countResult] = await this.request(commands);

    // countResult is the ZCARD response (count before adding new entry)
    const count = typeof countResult === 'number' ? countResult : 0;

    // If count (before this request) is already >= max, reject
    if (count >= max) {
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    // Request is allowed; remaining is (max - 1) for this request and below
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(0, max - (count + 1)),
    };
  }
}

/**
 * Singleton Redis client instance.
 * Initialized at startup with Upstash credentials from config.
 */
// reuse a single client instance across module reloads/cold starts
const globalForRedis = globalThis as unknown as { upstashClient?: UpstashRedisClient };

export function getRedisClient(): UpstashRedisClient {
  if (!globalForRedis.upstashClient) {
    globalForRedis.upstashClient = new UpstashRedisClient(
      config.upstashRedisRestUrl,
      config.upstashRedisRestToken
    );
  }
  return globalForRedis.upstashClient;
}

/**
 * Checks rate limit for a key and returns result.
 * Caller should map result to HTTP response.
 *
 * Example:
 *   const result = await checkRateLimit('ip:192.168.1.1', 5, 15 * 60 * 1000);
 *   if (!result.allowed) return res.status(429).json(error('RATE_LIMIT_EXCEEDED', 'Too many requests'));
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const client = getRedisClient();
    return await client.checkRateLimit(key, max, windowMs);
  } catch (err: unknown) {
    // Redis unavailable: fail open (allow request) or fail closed (reject).
    // For security, default to fail closed (reject); can be overridden by env.
    // Redis unavailable: use configured behaviour
    if (config.rateLimitFailOpen) {
      logger.warn('Rate limit check failed; failing open (allowing)', { key });
      return {
        allowed: true,
        limit: max,
        remaining: max,
      };
    } else {
      logger.error('Rate limit check failed; failing closed (rejecting)', { key });
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterSeconds: Math.ceil(config.loginRateLimitWindow / 1000),
      };
    }
  }
}

/**
 * Helper: get the client identifier from a request.
 * Prefers the forwarded IP (X-Forwarded-For) for proxy/load balancer setups.
 * Falls back to socket remote address.
 */
export function getClientIp(req: { headers?: Record<string, string | string[]>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded : forwarded.split(',');
    return ips[0]?.trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}
