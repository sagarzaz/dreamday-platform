/**
 * Redis-backed refresh token store using Upstash REST API (serverless friendly).
 */
import { config } from '../lib/config';
import { logger } from '../lib/logger';

async function upstashSet(key: string, value: string, ttlSeconds: number) {
  const url = config.upstashRedisRestUrl.replace(/\/$/, '');
  const token = config.upstashRedisRestToken;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value, ex: ttlSeconds }),
  });
  if (!res.ok) {
    const txt = await res.text();
    logger.error('Upstash set failed', { key, status: res.status, body: txt });
    throw new Error('Redis set failed');
  }
  return res.json();
}

async function upstashGet(key: string): Promise<string | null> {
  const url = config.upstashRedisRestUrl.replace(/\/$/, '');
  const token = config.upstashRedisRestToken;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    logger.error('Upstash get failed', { key, status: res.status, body: txt });
    throw new Error('Redis get failed');
  }
  const bodyAny = await res.json() as any;
  // Upstash returns { result: <value> } or { error }
  return bodyAny?.result ?? null;
}

async function upstashDel(key: string) {
  const url = config.upstashRedisRestUrl.replace(/\/$/, '');
  const token = config.upstashRedisRestToken;
  const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    logger.error('Upstash del failed', { key, status: res.status, body: txt });
    throw new Error('Redis del failed');
  }
  return res.json();
}

import type { RefreshTokenStore } from './login-service';

export const redisRefreshStore: RefreshTokenStore = {
  async set(key: string, userId: string, ttlSeconds: number) {
    await upstashSet(key, userId, ttlSeconds);
  },
  async get(key: string) {
    try {
      return await upstashGet(key);
    } catch (err) {
      logger.error('redisRefreshStore.get failed', { error: String(err) });
      return null;
    }
  },
  async delete(key: string) {
    await upstashDel(key);
  },
};
