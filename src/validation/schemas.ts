/**
 * DreamDay Platform — Request validation schemas (Zod).
 *
 * WHY validate before business logic:
 * - Invalid input is rejected at the edge with clear 422 messages; services assume typed, bounded data.
 * - Prevents injection and malformed payloads from reaching Prisma or Redis.
 * - Single source of truth for allowed shapes; OpenAPI/docs can be derived from these schemas.
 */

import { z } from 'zod';

/** Event date: must be ISO string and today or in the future; app will canonicalize to date for uniqueness. */
const eventDateSchema = z
  .string()
  .datetime({ message: 'eventDate must be ISO 8601 datetime' })
  .refine(
    (s) => {
      const d = new Date(s);
      d.setUTCHours(0, 0, 0, 0);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      return d >= today;
    },
    { message: 'eventDate must be today or in the future' }
  );

/** Positive integer for guest count and capacity. */
const positiveInt = z.number().int().positive();

// ----- Booking -----

export const createBookingSchema = z.object({
  eventHallId: z.string().uuid('Invalid eventHallId'),
  eventDate: eventDateSchema,
  guestCount: positiveInt,
  totalAmount: z.number().nonnegative().finite(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// ----- Login -----

export const loginSchema = z.object({
  email: z.string().email('Invalid email').max(320),
  password: z.string().min(1, 'Password is required').max(512),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ----- Hall search -----

export const hallSearchQuerySchema = z.object({
  district: z.string().max(120).optional(),
  minCapacity: z.coerce.number().int().min(0).optional(),
  maxBudget: z.coerce.number().nonnegative().finite().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type HallSearchFilters = z.infer<typeof hallSearchQuerySchema>;
