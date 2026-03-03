/**
 * DreamDay Platform — Hall discovery cache (Redis).
 *
 * WHY cache by (district, capacity, budget):
 * - Discovery is read-heavy; same filters are reused (e.g. "halls in Downtown for 200 guests under 5k").
 * - TTL 5 min balances freshness vs DB load; hall data changes infrequently.
 *
 * STALE DATA RISK:
 * - Up to 5 minutes after an EventHall update (price, active, deleted), clients may see old data.
 * - We invalidate on EventHall update (call invalidateHalls() from hall update handlers).
 * - For critical paths (e.g. booking), always re-validate against DB; cache is for listing only.
 */

export interface HallDiscoveryCacheClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

const KEY_PREFIX = 'dreamday:halls:';
const TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Builds a stable cache key from search params. Normalize order and values so
 * (district=A, capacity=100) and (capacity=100, district=A) hit the same key.
 */
export function buildHallDiscoveryCacheKey(params: {
  district?: string;
  minCapacity?: number;
  maxBudget?: number;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [
    params.district ?? '',
    String(params.minCapacity ?? 0),
    String(params.maxBudget ?? ''),
    String(params.limit),
    String(params.offset),
  ];
  return KEY_PREFIX + parts.join(':');
}

export class HallDiscoveryCachingLayer {
  constructor(
    private readonly redis: HallDiscoveryCacheClient,
    private readonly ttlSeconds: number = TTL_SECONDS
  ) {}

  async get(params: {
    district?: string;
    minCapacity?: number;
    maxBudget?: number;
    limit: number;
    offset: number;
  }): Promise<unknown | null> {
    const key = buildHallDiscoveryCacheKey(params);
    const raw = await this.redis.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async set(
    params: {
      district?: string;
      minCapacity?: number;
      maxBudget?: number;
      limit: number;
      offset: number;
    },
    value: unknown
  ): Promise<void> {
    const key = buildHallDiscoveryCacheKey(params);
    await this.redis.setex(key, this.ttlSeconds, JSON.stringify(value));
  }

  /**
   * Call when an EventHall is updated (price, active, deleted) so discovery cache
   * does not serve stale results. Deletes all keys matching hall discovery pattern.
   */
  async invalidateAll(): Promise<void> {
    const keys = await this.redis.keys(KEY_PREFIX + '*');
    await Promise.all(keys.map((k) => this.redis.del(k)));
  }
}
