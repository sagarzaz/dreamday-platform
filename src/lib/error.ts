/**
 * Centralized error mapping for serverless route handlers.
 *
 * Express had a middleware that examined the error and wrote the correct
 * status/envelope. In Next.js handlers we can't rely on middleware, so each
 * handler will call this helper in its `catch` block.
 *
 * The goal is the same as before:
 * - DomainError (custom) map to their httpStatus and code/message.
 * - Prisma unique violations become Conflict (409) with safe message.
 * - Unknown errors result in 500 with generic message.
 */

import { DomainError } from '../errors';
import { error as buildError, ApiErrorResponse } from './response';
import { Prisma } from '@prisma/client';

export function mapError(err: unknown): { body: ApiErrorResponse; status: number } {
  // Domain errors
  if (err instanceof DomainError) {
    const status = err.httpStatus;
    return {
      status,
      body: buildError(err.code, err.message),
    };
  }

  // Prisma unique constraint
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      if (target?.includes('eventHallId') && target?.includes('eventDate')) {
        return { status: 409, body: buildError('BOOKING_CONFLICT', 'This hall is already booked for the selected date.') };
      }
    }
    // fallback
    return { status: 500, body: buildError('DATABASE_ERROR', 'Database error') };
  }

  // generic
  return { status: 500, body: buildError('INTERNAL_ERROR', 'Internal server error') };
}
