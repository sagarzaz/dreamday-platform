/**
 * DreamDay Platform — Production-Grade JWT Authentication Library.
 *
 * WHY custom JWT instead of NextAuth:
 * - Smaller attack surface: we control all token signing/verification logic.
 * - Explicit security decisions documented in code (fail-fast, payload validation).
 * - Easier to adapt to a dedicated Node backend later (NextAuth is tightly coupled to Next.js).
 * - Demonstrates backend security understanding (required for fullstack roles).
 *
 * SECURITY PRINCIPLES:
 * - Never trust a decoded payload without verification (jwt.verify does this).
 * - Always validate token type (access vs refresh) in the payload.
 * - Strict expiration checks: refuse tokens even 1 second past expiry.
 * - Do not expose detailed failure reasons to client (prevents token enumeration attacks).
 * - Secrets are loaded from config (never hardcoded).
 */

import * as jwt from 'jsonwebtoken';
import { PlatformAccessRole } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { NextRequest, NextResponse } from 'next/server';

// Token type discriminators (prevents mixing token types)
export const TOKEN_TYPE = {
  ACCESS: 'access',
  REFRESH: 'refresh',
} as const;

/**
 * Access token payload: stateless, contains minimal user info for authorization decisions.
 * Verified on every protected request; should be short-lived (15 min typical).
 */
export interface AccessTokenPayload {
  sub: string;      // subject: userId
  email: string;    // for audit/logs
  role: PlatformAccessRole; // for role-based access control
  type: typeof TOKEN_TYPE.ACCESS;
  iat?: number;     // issued at (set by jwt.sign)
  exp?: number;     // expiration (set by jwt.sign with expiresIn)
}

/**
 * Refresh token payload: contains a token ID for revocation checks.
 * Stored in Redis with an expiration to match JWT expiration.
 * Longer-lived (7 days typical) but can be revoked server-side.
 */
export interface RefreshTokenPayload {
  sub: string;      // subject: userId
  jti: string;      // JWT ID for revocation tracking
  type: typeof TOKEN_TYPE.REFRESH;
  iat?: number;
  exp?: number;
}

/**
 * Result of token verification: either the payload (if valid) or an error.
 * Used to avoid try-catch in every route; enables standardized error handling.
 */
export type TokenVerificationResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'MALFORMED_TOKEN' | 'WRONG_TYPE' };

/**
 * Signs an access token with strict payload validation.
 * Throws if config is invalid (config loader already validated this).
 */
export function signAccessToken(payload: Omit<AccessTokenPayload, 'type' | 'iat' | 'exp'>): string {
  try {
    const opts: jwt.SignOptions = {
      expiresIn: config.jwtAccessExpiry as unknown as jwt.SignOptions['expiresIn'],
      issuer: 'dreamday',
    };
    return jwt.sign(
      { ...payload, type: TOKEN_TYPE.ACCESS } as AccessTokenPayload,
      config.jwtAccessSecret as jwt.Secret,
      opts
    );
  } catch (err) {
    logger.error('Failed to sign access token', { error: String(err) });
    throw new Error('Token signing failed');
  }
}

/**
 * Signs a refresh token with a unique ID for revocation tracking.
 * The token ID (jti) should be stored in Redis with a TTL matching token expiry.
 */
export function signRefreshToken(userId: string, tokenId: string): string {
  try {
    const opts: jwt.SignOptions = {
      expiresIn: config.jwtRefreshExpiry as unknown as jwt.SignOptions['expiresIn'],
      issuer: 'dreamday',
    };
    return jwt.sign(
      { sub: userId, jti: tokenId, type: TOKEN_TYPE.REFRESH } as RefreshTokenPayload,
      config.jwtRefreshSecret as jwt.Secret,
      opts
    );
  } catch (err) {
    logger.error('Failed to sign refresh token', { error: String(err) });
    throw new Error('Token signing failed');
  }
}

/**
 * Verifies an access token and returns result (no exception).
 * Checks:
 * 1. Token signature is valid (using the secret)
 * 2. Token has not expired
 * 3. Token type is 'access'
 *
 * Returns { ok: false, reason } if verification fails; caller decides how to respond.
 */
export function verifyAccessToken(token: string): TokenVerificationResult<AccessTokenPayload> {
  try {
    const payload = jwt.verify(token, config.jwtAccessSecret, {
      issuer: 'dreamday',
      algorithms: ['HS256'], // Enforce algorithm to prevent key confusion
    }) as AccessTokenPayload;

    // Type check: ensure this is an access token, not a refresh token or unknown type
    if (payload.type !== TOKEN_TYPE.ACCESS) {
      return { ok: false, reason: 'WRONG_TYPE' };
    }

    // Redundant check (jwt.verify already checks exp), but explicit for clarity
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { ok: false, reason: 'EXPIRED_TOKEN' };
    }

    return { ok: true, payload };
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || String(err);

    // Categorize jwt errors
    if (errorMsg.includes('malformed')) {
      return { ok: false, reason: 'MALFORMED_TOKEN' };
    }
    if (errorMsg.includes('expired') || errorMsg.includes('jwt expired')) {
      return { ok: false, reason: 'EXPIRED_TOKEN' };
    }
    if (errorMsg.includes('invalid')) {
      return { ok: false, reason: 'INVALID_TOKEN' };
    }

    // Unknown error: treat as invalid for security
    logger.warn('Token verification error', { error: errorMsg });
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
}

/**
 * Verifies a refresh token (similar to access token verification).
 * In production, also check if the token ID (jti) is revoked in Redis.
 */
export function verifyRefreshToken(token: string): TokenVerificationResult<RefreshTokenPayload> {
  try {
    const payload = jwt.verify(token, config.jwtRefreshSecret, {
      issuer: 'dreamday',
      algorithms: ['HS256'],
    }) as RefreshTokenPayload;

    if (payload.type !== TOKEN_TYPE.REFRESH) {
      return { ok: false, reason: 'WRONG_TYPE' };
    }

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { ok: false, reason: 'EXPIRED_TOKEN' };
    }

    return { ok: true, payload };
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || String(err);

    if (errorMsg.includes('malformed')) {
      return { ok: false, reason: 'MALFORMED_TOKEN' };
    }
    if (errorMsg.includes('expired') || errorMsg.includes('jwt expired')) {
      return { ok: false, reason: 'EXPIRED_TOKEN' };
    }
    if (errorMsg.includes('invalid')) {
      return { ok: false, reason: 'INVALID_TOKEN' };
    }

    logger.warn('Token verification error', { error: errorMsg });
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
}

/**
 * Generic role checker: verifies that the user's role is in the allowed list.
 * Used by role-guard middleware.
 */
export function hasRole(userRole: PlatformAccessRole, ...allowedRoles: PlatformAccessRole[]): boolean {
  return allowedRoles.includes(userRole);
}

/**
 * Generates a cryptographically secure token ID for refresh token revocation tracking.
 * Implementation note: in production, use a UUID library (e.g., uuid v4) or crypto.randomUUID().
 * Here we use Node's crypto for demonstration.
 */
export function generateTokenId(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(16).toString('hex');
}

/**
 * Higher-order wrapper for Next.js route handlers that require authentication.
 *
 * USAGE:
 *   export const POST = withAuth(async (req, user) => { ... });
 *   export const GET = withAuth(handler, PLATFORM_SUPERADMIN);
 *
 * The wrapper extracts the Bearer token from the Authorization header,
 * verifies it, and optionally enforces role membership. On failure it
 * returns a standardized 401/403 response without exposing details.
 *
 * We embed this into the serverless route layer (Next.js) because Express
 * middleware is not available. The wrapper returns a function with the same
 * signature as a Next.js route handler.
 */
export function withAuth(
  handler: (req: NextRequest, user: AccessTokenPayload) => Promise<NextResponse> | NextResponse,
  requiredRole?: PlatformAccessRole | PlatformAccessRole[]
) {
  return async (req: NextRequest) => {
    const makeResponse = (body: any, status = 200) => {
      if (config.nodeEnv === 'test') return { status, body } as any;
      return NextResponse.json(body, { status });
    };
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return makeResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    const verification = verifyAccessToken(token);
    if (!verification.ok) {
      return makeResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
    }

    const payload = verification.payload;
    if (requiredRole) {
      const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!hasRole(payload.role, ...allowed)) {
        return makeResponse({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
      }
    }

    // delegate to handler with user information attached
    try {
      const result = await handler(req, payload) as any;
      if (config.nodeEnv === 'test') return result;
      return result;
    } catch (err: unknown) {
      logger.error('withAuth handler error', { error: String(err) });
      return makeResponse({ success: false, error: { code: 'INTERNAL_ERROR' } }, 500);
    }
  };
}
