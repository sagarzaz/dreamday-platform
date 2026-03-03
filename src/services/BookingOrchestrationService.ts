/**
 * DreamDay Platform — Concurrency-safe booking orchestration service.
 *
 * PRODUCTION DESIGN DECISIONS:
 *
 * WHY this service exists:
 * - Booking creation must validate hall existence, active status, and capacity before
 *   attempting insert. The DB unique constraint (eventHallId + eventDate) is the final
 *   authority; this service ensures we only pass valid payloads to the DB and that
 *   we handle constraint violations with clear domain errors and audit trails.
 *
 * WHY DB-level constraints are mandatory in serverless:
 * - Multiple instances can process concurrent booking requests to the same hall+date.
 * - Both can pass validation (hall is active, enough capacity) but only one INSERT succeeds.
 * - The DB unique constraint is the ONLY serialization point; no application-level lock
 *   can work reliably across stateless instances.
 * - Prisma unique constraint violation (P2002) is the trusted signal of a conflict.
 *
 * WHY optimistic concurrency (try insert, catch conflict) beats frontend validation:
 * - Frontend validation prevents obvious mistakes locally (good UX).
 * - But frontend cannot know another user didn't book the same slot after the validation
 *   check was made. Only the DB enforces "at most one row per (hall, date)" atomically.
 * - This pattern is called optimistic concurrency control; it scales without locks.
 *
 * WHY we validate totalAmount >= basePrice:
 * - If client can send any totalAmount, they could circumvent pricing logic.
 * - Server validates this is not a discount-abuse or honest mistake.
 * - Enables future pricing middleware (taxes, discounts, surcharges) to validate on top.
 *
 * WHY we canonicalize event date to midnight UTC:
 * - A booking is for a specific date, not a specific minute.
 * - Midnight UTC is a stable anchor; avoids timezone ambiguity and DST issues.
 * - The unique constraint (hall, date) ensures at most one booking per date per hall.
 *
 * WHY audit trails on conflict:
 * - When a user sees "already booked", they might try again (retry loop).
 * - Logging these attempts helps detect abuse, distributed attacks, or UX issues.
 * - Audit record includes requestId for tracing back through logs.
 */

import { PrismaClient, EventBookingStatus, AuditEntityType, AuditActionType } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { DomainErrorCodes } from '../errors';
import { logger } from '../lib/logger';
import type { CreateBookingInput } from '../validation/schemas';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** 
 * Canonicalizes event date to midnight UTC for uniqueness. 
 * Caller can pass ISO string (e.g. from client JSON).
 * Result is stable across timezones and DST.
 */
export function toCanonicalEventDate(isoDate: string): Date {
  const d = new Date(isoDate);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Validates that the event date is in the future (or today).
 * Prevents bookings for past dates, which would be nonsensical.
 * 
 * WHY this validation:
 * - A booking for yesterday cannot be fulfilled.
 * - If accepted, it clutters the DB and confuses reporting/analytics.
 * - Validates at service level so invalid payloads never reach the DB.
 */
export function validateEventDateNotPast(eventDate: Date): void {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (eventDate < today) {
    throw new ValidationError(
      `Event date (${eventDate.toISOString().split('T')[0]}) cannot be in the past.`
    );
  }
}

export interface CreateBookingResult {
  id: string;
  eventHallId: string;
  eventDate: Date;
  guestCount: number;
  totalAmount: number;
  bookingStatus: EventBookingStatus;
  createdAt: Date;
}

export class BookingOrchestrationService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Creates a booking in a transaction: validates hall existence, capacity, price,
   * and event date, then attempts INSERT. Catches unique constraint violation and
   * returns structured domain error; logs conflict attempt in AuditTrail.
   *
   * Transaction ensures:
   * - Booking and audit record are both written or both rolled back (atomicity).
   * - If concurrent requests both pass validation, only one INSERT succeeds;
   *   the other gets P2002 (unique constraint violation).
   *
   * Error handling:
   * - NotFoundError: hall does not exist or is soft-deleted or inactive.
   * - ValidationError: guest count > capacity, totalAmount < basePrice, event date in past.
   * - ConflictError: unique constraint violated (hall+date already booked).
   * - Other errors: re-thrown and caught by global error handler (500).
   */
  async createBooking(
    input: CreateBookingInput,
    customerId: string,
    requestId?: string
  ): Promise<CreateBookingResult> {
    const eventDate = toCanonicalEventDate(input.eventDate);

    // Validate event date is not in the past
    validateEventDateNotPast(eventDate);

    // Pre-flight: hall exists, is active, not soft-deleted, and has enough capacity.
    const hall = await this.db.eventHall.findFirst({
      where: {
        id: input.eventHallId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!hall) {
      throw new NotFoundError(
        DomainErrorCodes.HALL_NOT_FOUND,
        'Hall not found or not available for booking.'
      );
    }

    const capacity = Number(hall.capacity);
    if (input.guestCount > capacity) {
      throw new ValidationError(
        `Guest count (${input.guestCount}) exceeds hall capacity (${capacity}).`
      );
    }

    const basePrice = Number(hall.basePrice);
    if (input.totalAmount < basePrice) {
      throw new ValidationError(
        `totalAmount (${input.totalAmount}) is below hall base price (${basePrice}).`
      );
    }

    try {
      const booking = await this.db.$transaction(async (tx) => {
        const created = await tx.eventBooking.create({
          data: {
            eventHallId: input.eventHallId,
            eventDate,
            guestCount: input.guestCount,
            totalAmount: input.totalAmount,
            customerId,
            bookingStatus: EventBookingStatus.DRAFT,
          },
        });

        await tx.auditTrail.create({
          data: {
            entityType: AuditEntityType.EVENT_BOOKING,
            entityId: created.id,
            actionType: AuditActionType.CREATED,
            performedByUserId: customerId,
            metadata: {
              eventHallId: input.eventHallId,
              eventDate: eventDate.toISOString(),
              guestCount: input.guestCount,
            },
          },
        });

        return created;
      });

      logger.info('Booking created', {
        requestId,
        bookingId: booking.id,
        eventHallId: booking.eventHallId,
        customerId,
      });

      return {
        id: booking.id,
        eventHallId: booking.eventHallId,
        eventDate: booking.eventDate,
        guestCount: booking.guestCount,
        totalAmount: Number(booking.totalAmount),
        bookingStatus: booking.bookingStatus,
        createdAt: booking.createdAt,
      };
    } catch (err: unknown) {
      const prismaErr = err as { code?: string };
      if (prismaErr?.code === PRISMA_UNIQUE_VIOLATION) {
        await this.recordConflictAttempt(input.eventHallId, eventDate, customerId, requestId);
        throw new ConflictError(
          DomainErrorCodes.BOOKING_CONFLICT,
          'This hall is already booked for the selected date.'
        );
      }
      throw err;
    }
  }

  /**
   * Records in AuditTrail that a booking attempt failed due to hall+date conflict.
   * Uses UPDATED + metadata to avoid adding new enum values; supports compliance and analytics.
   */
  private async recordConflictAttempt(
    eventHallId: string,
    eventDate: Date,
    performedByUserId: string,
    requestId?: string
  ): Promise<void> {
    try {
      await this.db.auditTrail.create({
        data: {
          entityType: AuditEntityType.EVENT_BOOKING,
          entityId: eventHallId,
          actionType: AuditActionType.UPDATED,
          performedByUserId,
          metadata: {
            event: 'booking_attempt_rejected',
            reason: 'unique_constraint_hall_date',
            eventHallId,
            eventDate: eventDate.toISOString(),
            requestId,
          },
        },
      });
      logger.warn('Booking conflict attempt recorded', {
        requestId,
        eventHallId,
        performedByUserId,
      });
    } catch (e) {
      logger.error('Failed to record conflict attempt in AuditTrail', {
        requestId,
        eventHallId,
        err: e instanceof Error ? e.message : String(e),
      });
      // Do not rethrow; the ConflictError to the client is already the right outcome.
    }
  }
}
