/**
 * Auth middleware: requireAuth and requireRoles.
 * WHY: Protected routes must reject missing/invalid tokens and wrong roles.
 */
import { withAuth } from '../src/lib/auth';
import { signAccessToken } from '../src/auth/tokens';
import { PlatformAccessRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

// helpers to simulate NextRequest
function mockReq(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return {
    headers,
    url: 'http://localhost/api',
    method: 'GET',
    // minimal implementation for needed properties
  } as unknown as NextRequest;
}

// we don't need Response mocks since withAuth returns NextResponse objects

describe('withAuth wrapper', () => {
  const handler = jest.fn(async (_req: NextRequest, user) => {
    // return a valid NextResponse so types are happy
    return NextResponse.json({ success: true, user });
  });

  it('allows request with valid token', async () => {
    const payload = { sub: 'user-1', email: 'a@b.com', role: PlatformAccessRole.CUSTOMER_CLIENT };
    const token = signAccessToken(payload);
    const req = mockReq(`Bearer ${token}`);
    const wrapped = withAuth(handler);
    const res = await wrapped(req as any);
    expect(res).toBeDefined();
    expect(handler).toHaveBeenCalled();
  });

  it('returns 401 when token missing', async () => {
    const req = mockReq();
    const wrapped = withAuth(handler);
    const res: any = await wrapped(req as any);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('enforces roles when provided', async () => {
    const payload = { sub: 'user-1', email: 'a@b.com', role: PlatformAccessRole.CUSTOMER_CLIENT };
    const token = signAccessToken(payload);
    const req = mockReq(`Bearer ${token}`);
    const wrapped = withAuth(handler, PlatformAccessRole.PLATFORM_SUPERADMIN);
    const res: any = await wrapped(req as any);
    expect(res.status).toBe(403);
  });
});
