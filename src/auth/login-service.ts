/**
 * Login: verify credentials, check account status, issue access + refresh tokens.
 * Brute-force mitigation is handled by rate-limiting middleware on the login route.
 */
import { PrismaClient, PlatformAccountStatus } from '@prisma/client';
import { verifyPassword } from './password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './tokens';
import { UnauthorizedError } from '../errors';
import type { LoginInput } from '../validation/schemas';
import { randomUUID } from 'crypto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface RefreshTokenStore {
  set(key: string, userId: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export class LoginService {
  constructor(
    private readonly db: PrismaClient,
    private readonly refreshStore: RefreshTokenStore
  ) {}

  async login(input: LoginInput): Promise<{ user: { id: string; email: string; role: string }; tokens: TokenPair }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.db.platformUser.findFirst({
      where: {
        email: normalizedEmail,
        deletedAt: null,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.accountStatus === PlatformAccountStatus.LOCKED) {
      throw new UnauthorizedError('Account is locked. Contact support.');
    }
    if (user.accountStatus === PlatformAccountStatus.SUSPENDED) {
      throw new UnauthorizedError('Account is suspended.');
    }
    if (user.accountStatus === PlatformAccountStatus.DEPROVISIONED) {
      throw new UnauthorizedError('Account is deactivated.');
    }
    if (user.accountStatus !== PlatformAccountStatus.ACTIVE && user.accountStatus !== PlatformAccountStatus.PENDING_VERIFICATION) {
      throw new UnauthorizedError('Account is not active.');
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const jti = randomUUID();
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken(user.id, jti);
    const refreshTtl = 7 * 24 * 60 * 60;
    await this.refreshStore.set(jti, user.id, refreshTtl);

    return {
      user: { id: user.id, email: user.email, role: user.role },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '15m',
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = verifyRefreshToken(refreshToken);
    const userId = await this.refreshStore.get(payload.jti);
    if (!userId || userId !== payload.sub) {
      throw new UnauthorizedError('Refresh token invalid or revoked');
    }
    const user = await this.db.platformUser.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user || user.accountStatus !== PlatformAccountStatus.ACTIVE && user.accountStatus !== PlatformAccountStatus.PENDING_VERIFICATION) {
      await this.refreshStore.delete(payload.jti);
      throw new UnauthorizedError('Account no longer active');
    }
    await this.refreshStore.delete(payload.jti);
    const jti2 = randomUUID();
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const newRefresh = signRefreshToken(user.id, jti2);
    await this.refreshStore.set(jti2, user.id, 7 * 24 * 60 * 60);
    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: '15m',
    };
  }
}
