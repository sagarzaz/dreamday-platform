import { NextRequest, NextResponse } from 'next/server';
import { createBookingSchema } from '../../../../../src/validation/schemas';
import { bookingService } from '../../../../../src/lib/services';
import { config } from '../../../../../src/lib/config';
import { success, error } from '../../../../../src/lib/response';
import { checkRateLimit } from '../../../../../src/lib/rateLimit';
import { withAuth } from '../../../../../src/lib/auth';
import { PlatformAccessRole } from '@prisma/client';

export const POST = withAuth(async (req: NextRequest, user) => {
  // parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(error('INVALID_REQUEST', 'Malformed JSON'), { status: 400 });
  }

  const parse = createBookingSchema.safeParse(body);
  if (!parse.success) {
    const first = parse.error.errors[0];
    const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input';
    return NextResponse.json(error('VALIDATION_FAILED', msg), { status: 422 });
  }

  // rate limit by userId
  const rl = await checkRateLimit(`bookings:create:${user.sub}`, config.bookingRateLimit, config.bookingRateLimitWindow);
  if (!rl.allowed) {
    return NextResponse.json(error('RATE_LIMIT_EXCEEDED', 'Too many bookings'), { status: 429 });
  }

  try {
    const requestId = req.headers.get('x-request-id') || undefined;
    const result = await bookingService.createBooking(parse.data, user.sub, requestId);
    return NextResponse.json(success(result), { status: 201 });
  } catch (err: unknown) {
    const { body, status } = await import('../../../../../src/lib/error').then((m) => m.mapError(err));
    return NextResponse.json(body, { status });
  }
}, [
  PlatformAccessRole.CUSTOMER_CLIENT,
  PlatformAccessRole.PLATFORM_SUPERADMIN,
  PlatformAccessRole.EVENT_COORDINATOR,
]);
