import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../src/lib/prisma';
import { success, error } from '../../../../../src/lib/response';

export async function GET(req: NextRequest) {
  const { searchParams, pathname } = new URL(req.url);
  // extract id from pathname
  const parts = pathname.split('/');
  const id = parts[parts.length - 1];

  try {
    const hall = await prisma.eventHall.findFirst({
      where: { id, deletedAt: null },
    });
    if (!hall) {
      return NextResponse.json(error('HALL_NOT_FOUND', 'Hall not found'), { status: 404 });
    }
    return NextResponse.json(success(hall));
  } catch (err: any) {
    const code = err.code || 'INTERNAL_ERROR';
    const status = err.httpStatus || 500;
    return NextResponse.json(error(code, err.message || 'Server error'), { status });
  }
}
