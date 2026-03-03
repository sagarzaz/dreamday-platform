import { NextResponse } from 'next/server';
import { prisma } from '../../../../../src/lib/prisma';
import { logger } from '../../../../../src/lib/logger';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err);
    logger.error('Readiness check failed', { error: msg });
    return NextResponse.json({ status: 'not_ready', timestamp: new Date().toISOString(), reason: 'Database unavailable' }, { status: 503 });
  }
}
