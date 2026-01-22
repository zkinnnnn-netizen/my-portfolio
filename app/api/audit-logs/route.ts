/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const result = searchParams.get('result');
  const important = searchParams.get('important');

  const where: any = {};
  const dateFilter: any = {};

  if (from) {
    dateFilter.gte = new Date(from);
  }
  if (to) {
    dateFilter.lte = new Date(to);
  }
  if (Object.keys(dateFilter).length > 0) {
    where.createdAt = dateFilter;
  }
  if (result) {
    where.result = result;
  }
  if (important === 'true') {
    where.isImportant = true;
  }

  const logs = await prisma.auditLog.findMany({
    where,
    include: { item: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(logs);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (body.action === 'cleanup') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.auditLog.deleteMany({
      where: {
        isImportant: false,
        createdAt: { lt: cutoff },
      },
    });
    return NextResponse.json({ deleted: result.count });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

