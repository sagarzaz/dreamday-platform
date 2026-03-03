import { NextRequest, NextResponse } from 'next/server';
import { loginService } from '../../../../../src/lib/services';
import { success, error } from '../../../../../src/lib/response';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(error('INVALID_REQUEST', 'Malformed JSON'), { status: 400 });
  }

  const refreshToken = (body as any)?.refreshToken || req.headers.get('x-refresh-token');
  if (!refreshToken || typeof refreshToken !== 'string') {
    return NextResponse.json(error('VALIDATION_FAILED', 'refreshToken is required'), { status: 422 });
  }

  try {
    const tokens = await loginService.refresh(refreshToken);
    return NextResponse.json(success(tokens), { status: 200 });
  } catch (err: unknown) {
    const { body, status } = await import('../../../../../src/lib/error').then((m) => m.mapError(err));
    return NextResponse.json(body, { status });
  }
}
