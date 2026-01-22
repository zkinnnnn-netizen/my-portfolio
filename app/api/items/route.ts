/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const hoursParam = searchParams.get('hours');
  const hours = hoursParam ? parseInt(hoursParam, 10) || 24 : 24;

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const where: any = {
    createdAt: {
      gte: since,
    },
  };

  if (status && status !== 'ALL') {
    where.status = status;
  }

  const items = await prisma.item.findMany({
    where,
    include: { source: true },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json(items);
}
