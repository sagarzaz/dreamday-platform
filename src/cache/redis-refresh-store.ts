/**
 * Redis-backed refresh token store. Key = refresh JTI, value = userId; TTL = token lifetime.
 */
import type { RefreshTokenStore } from '../auth/login-service';

const PREFIX = 'dreamday:refresh:';

export function createRedisRefreshStore(redis: { setex: (k: string, t: number, v: string) => Promise<string>; get: (k: string) => Promise<string | null>; del: (k: string) => Promise<number> }): RefreshTokenStore {
  return {
    async set(key: string, userId: string, ttlSeconds: number): Promise<void> {
      await redis.setex(PREFIX + key, ttlSeconds, userId);
    },
    async get(key: string): Promise<string | null> {
      return redis.get(PREFIX + key);
    },
    async delete(key: string): Promise<void> {
      await redis.del(PREFIX + key);
    },
  };
}
