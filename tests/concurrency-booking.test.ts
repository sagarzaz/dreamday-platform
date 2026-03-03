/**
 * Concurrency simulation: multiple createBooking for same hall+date.
 * WHY CRITICAL: In production, two users can submit at the same time; only one must succeed.
 * The DB unique constraint is the single source of truth; this test verifies we handle P2002 and return ConflictError.
 */
import { PrismaClient } from '@prisma/client';
import { BookingOrchestrationService } from '../src/services/BookingOrchestrationService';
import { ConflictError } from '../src/errors';

// Use real Prisma with a test DB or skip when no DB. For CI without DB we use mocks.
const useRealDb = process.env.TEST_DATABASE_URL != null;

describe('Concurrency: same hall+date', () => {
  it('only one of N concurrent createBooking calls succeeds when targeting same hall+date', async () => {
    if (!useRealDb) {
      // Mock: simulate transaction that throws P2002 for all but first call
      let callCount = 0;
      const db = {
        eventHall: { findFirst: jest.fn().mockResolvedValue({ id: 'h1', capacity: 200, isActive: true, deletedAt: null }) },
        $transaction: jest.fn().mockImplementation(async (fn) => {
          callCount++;
          if (callCount === 1) {
            return fn({
              eventBooking: { create: jest.fn().mockResolvedValue({ id: 'b1', eventHallId: 'h1', eventDate: new Date(), guestCount: 10, totalAmount: 100, bookingStatus: 'DRAFT', createdAt: new Date(), updatedAt: new Date() }) },
              auditTrail: { create: jest.fn().mockResolvedValue({}) },
            });
          }
          const err = new Error('P2002') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }),
        auditTrail: { create: jest.fn().mockResolvedValue({}) },
      } as unknown as PrismaClient;
      const service = new BookingOrchestrationService(db);
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      future.setUTCHours(0, 0, 0, 0);
      const input = { eventHallId: 'h1', eventDate: future.toISOString(), guestCount: 10, totalAmount: 100 };
      const results = await Promise.allSettled([
        service.createBooking(input, 'user-1'),
        service.createBooking(input, 'user-2'),
        service.createBooking(input, 'user-3'),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);
      rejected.forEach((r) => {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      });
      return;
    }
    // Real DB: create one hall, run N concurrent bookings, expect 1 success and N-1 ConflictError
    const prisma = new PrismaClient();
    const service = new BookingOrchestrationService(prisma);
    const hall = await prisma.eventHall.create({
      data: {
        hallName: 'Concurrency Test Hall',
        district: 'Test',
        capacity: 100,
        basePrice: 1000,
        latitude: 0,
        longitude: 0,
      },
    });
    const future2 = new Date();
    future2.setFullYear(future2.getFullYear() + 1);
    future2.setUTCHours(0, 0, 0, 0);
    const eventDate = future2.toISOString();
    const customerIds = ['cust-a', 'cust-b', 'cust-c'];
    const results = await Promise.allSettled(
      customerIds.map((cid) =>
        service.createBooking(
          { eventHallId: hall.id, eventDate, guestCount: 10, totalAmount: 1000 },
          cid
        )
      )
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);
    rejected.forEach((r) => {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
    await prisma.eventBooking.deleteMany({ where: { eventHallId: hall.id } });
    await prisma.eventHall.delete({ where: { id: hall.id } });
    await prisma.$disconnect();
  }, 15000);
});
