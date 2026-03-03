/**
 * JWT access and refresh token issuance and verification.
 * Access: short-lived (15 min), stateless. Refresh: longer (7d), stored in Redis for revocation.
 *
 * Production: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set; we fail fast to avoid
 * accepting tokens signed with a default.
 */
import * as jwt from 'jsonwebtoken';
import type { PlatformAccessRole } from '@prisma/client';
import { config } from '../lib/config';

// Use values from validated configuration; tests supply defaults.
const ACCESS_EXP = config.jwtAccessExpiry;
const REFRESH_EXP = config.jwtRefreshExpiry;

export interface AccessPayload {
  sub: string;   // userId
  email: string;
  role: PlatformAccessRole;
  type: 'access';
}

export interface RefreshPayload {
  sub: string;
  jti: string;   // token id for revocation
  type: 'refresh';
}

export function signAccessToken(payload: Omit<AccessPayload, 'type'>): string {
  // build options separately to ensure TypeScript picks the correct overload
  // `SignOptions.expiresIn` is typed as `StringValue | number`; the latter
  // unfortunately doesn't include plain strings in the current @types version,
  // so cast to bypass the mismatch.
  const opts: jwt.SignOptions = {
    expiresIn: ACCESS_EXP as unknown as jwt.SignOptions['expiresIn'],
    issuer: 'dreamday',
  };
  return jwt.sign(
    { ...payload, type: 'access' as const },
    config.jwtAccessSecret as jwt.Secret,
    opts
  );
}

export function signRefreshToken(userId: string, jti: string): string {
  const opts: jwt.SignOptions = {
    expiresIn: REFRESH_EXP as unknown as jwt.SignOptions['expiresIn'],
    issuer: 'dreamday',
  };
  return jwt.sign(
    { sub: userId, jti, type: 'refresh' as const },
    config.jwtRefreshSecret as jwt.Secret,
    opts
  );
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, config.jwtAccessSecret as jwt.Secret) as AccessPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type');
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const decoded = jwt.verify(token, config.jwtRefreshSecret as jwt.Secret) as RefreshPayload;
  if (decoded.type !== 'refresh') throw new Error('Invalid token type');
  return decoded;
}
