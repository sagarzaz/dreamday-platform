/**
 * Unit tests for BookingOrchestrationService.
 * WHY: Booking is the critical path; we must verify hall validation, capacity, and conflict handling.
 */
import { BookingOrchestrationService, toCanonicalEventDate } from '../src/services/BookingOrchestrationService';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors';
import { PrismaClient } from '@prisma/client';

describe('toCanonicalEventDate', () => {
  it('normalizes to midnight UTC', () => {
    const d = toCanonicalEventDate('2025-06-15T14:30:00.000Z');
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCDate()).toBe(15);
  });
});

describe('BookingOrchestrationService', () => {
  const mockHall = {
    id: 'hall-1',
    hallName: 'Grand Hall',
    district: 'Downtown',
    capacity: 200,
    basePrice: 5000,
    latitude: 0,
    longitude: 0,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('throws NotFoundError when hall does not exist', async () => {
    const db = {
      eventHall: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
      auditTrail: { create: jest.fn() },
    } as unknown as PrismaClient;
    const service = new BookingOrchestrationService(db);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    future.setUTCHours(0, 0, 0, 0);
    await expect(
      service.createBooking(
        { eventHallId: 'missing', eventDate: future.toISOString(), guestCount: 50, totalAmount: 5000 },
        'user-1'
      )
    ).rejects.toThrow(NotFoundError);
    expect(db.eventHall.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing', isActive: true, deletedAt: null } })
    );
  });

  it('throws ValidationError when guestCount exceeds capacity', async () => {
    const db = {
      eventHall: { findFirst: jest.fn().mockResolvedValue(mockHall) },
      $transaction: jest.fn(),
      auditTrail: { create: jest.fn() },
    } as unknown as PrismaClient;
    const service = new BookingOrchestrationService(db);
    const future2 = new Date();
    future2.setFullYear(future2.getFullYear() + 1);
    future2.setUTCHours(0, 0, 0, 0);
    await expect(
      service.createBooking(
        { eventHallId: 'hall-1', eventDate: future2.toISOString(), guestCount: 300, totalAmount: 5000 },
        'user-1'
      )
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError on unique constraint violation', async () => {
    const prismaError = { code: 'P2002', meta: { target: ['eventHallId', 'eventDate'] } };
    const db = {
      eventHall: { findFirst: jest.fn().mockResolvedValue(mockHall) },
      $transaction: jest.fn().mockRejectedValue(prismaError),
      auditTrail: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const service = new BookingOrchestrationService(db);
    const future3 = new Date();
    future3.setFullYear(future3.getFullYear() + 1);
    future3.setUTCHours(0, 0, 0, 0);
    await expect(
      service.createBooking(
        { eventHallId: 'hall-1', eventDate: future3.toISOString(), guestCount: 50, totalAmount: 5000 },
        'user-1'
      )
    ).rejects.toThrow(ConflictError);
  });

  it('returns booking on success', async () => {
    const future4 = new Date();
    future4.setFullYear(future4.getFullYear() + 1);
    future4.setUTCHours(0, 0, 0, 0);
    const created = {
      id: 'booking-1',
      eventHallId: 'hall-1',
      eventDate: future4,
      guestCount: 50,
      totalAmount: 5000,
      customerId: 'user-1',
      bookingStatus: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      eventHall: { findFirst: jest.fn().mockResolvedValue(mockHall) },
      $transaction: jest.fn().mockImplementation((fn) => fn({
        eventBooking: { create: jest.fn().mockResolvedValue(created) },
        auditTrail: { create: jest.fn().mockResolvedValue({}) },
      })),
      auditTrail: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const service = new BookingOrchestrationService(db);
    const result = await service.createBooking(
      { eventHallId: 'hall-1', eventDate: future4.toISOString(), guestCount: 50, totalAmount: 5000 },
      'user-1'
    );
    expect(result.id).toBe('booking-1');
    expect(result.bookingStatus).toBe('DRAFT');
  });
});
