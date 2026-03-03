import { NextRequest, NextResponse } from 'next/server';
import { loginSchema } from '../../../../../src/validation/schemas';
import { loginService } from '../../../../../src/lib/services';
import { config } from '../../../../../src/lib/config';
import { success, error } from '../../../../../src/lib/response';
import { checkRateLimit, getClientIp } from '../../../../../src/lib/rateLimit';

export async function POST(req: NextRequest) {
  // parse body safely
  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json(
      error('INVALID_REQUEST', 'Malformed JSON'),
      { status: 400 }
    );
  }

  const parseResult = loginSchema.safeParse(body);
  if (!parseResult.success) {
    const first = parseResult.error.errors[0];
    const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input';
    return NextResponse.json(error('VALIDATION_FAILED', msg), { status: 422 });
  }

  // rate limit by client IP
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`auth:login:${ip}`, config.loginRateLimit, config.loginRateLimitWindow);
  if (!rl.allowed) {
    return NextResponse.json(error('RATE_LIMIT_EXCEEDED','Too many login attempts'), { status: 429 });
  }

  try {
    const result = await loginService.login(parseResult.data);
    return NextResponse.json(success(result), { status: 200 });
  } catch (err: unknown) {
    const { body, status } = await import('../../../../../src/lib/error').then((m) => m.mapError(err));
    return NextResponse.json(body, { status });
  }
}
