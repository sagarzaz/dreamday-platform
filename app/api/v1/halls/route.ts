import { NextRequest, NextResponse } from 'next/server';
import { hallSearchQuerySchema } from '../../../../../src/validation/schemas';
import { hallCache } from '../../../../../src/lib/services';
import { prisma } from '../../../../../src/lib/prisma';
import { success, error } from '../../../../../src/lib/response';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryObj: any = {};
  searchParams.forEach((value, key) => {
    queryObj[key] = value;
  });

  const parse = hallSearchQuerySchema.safeParse(queryObj);
  if (!parse.success) {
    const first = parse.error.errors[0];
    const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Invalid query';
    return NextResponse.json(error('VALIDATION_FAILED', msg), { status: 422 });
  }
  const query = parse.data;

  if (hallCache) {
    const cached = await hallCache.get(query);
    if (cached != null) {
      return NextResponse.json(success(cached));
    }
  }

  const where: any = { isActive: true, deletedAt: null };
  if (query.district) where.district = query.district;
  if (query.minCapacity != null) where.capacity = { gte: query.minCapacity };
  if (query.maxBudget != null) where.basePrice = { lte: query.maxBudget };

  try {
    const [halls, total] = await Promise.all([
      prisma.eventHall.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          hallName: true,
          district: true,
          capacity: true,
          basePrice: true,
          latitude: true,
          longitude: true,
        },
      }),
      prisma.eventHall.count({ where }),
    ]);

    const data = { items: halls, total };
    if (hallCache) await hallCache.set(query, data);
    return NextResponse.json(success(data));
  } catch (err: unknown) {
    const { body, status } = await import('../../../../../src/lib/error').then((m) => m.mapError(err));
    return NextResponse.json(body, { status });
  }
}

