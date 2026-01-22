/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type SourceInput = {
  name: string;
  type: string;
  url: string;
  regionTag?: string | null;
  categoryTag?: string | null;
  priority?: number | string;
  isActive?: boolean;
  fetchIntervalMinutes?: number;
};

export async function POST(request: Request) {
  const body = await request.json();
  const items: SourceInput[] = body.sources;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const results: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < items.length; i++) {
    const input = items[i];
    try {
      if (!input || !input.name || !input.type || !input.url) {
        throw new Error('Missing required fields');
      }

      const type = input.type.toUpperCase();
      if (type !== 'RSS' && type !== 'HTML') {
        throw new Error('Invalid type');
      }

      const priorityNumber = typeof input.priority === 'string' ? parseInt(input.priority, 10) : input.priority;
      const priority = Number.isFinite(priorityNumber) ? Number(priorityNumber) : 3;
      const interval = input.fetchIntervalMinutes && Number.isFinite(input.fetchIntervalMinutes) ? input.fetchIntervalMinutes : 60;

      const data = {
        name: input.name,
        type,
        url: input.url,
        regionTag: input.regionTag ?? null,
        categoryTag: input.categoryTag ?? null,
        priority,
        isActive: input.isActive ?? true,
        fetchIntervalMinutes: interval,
      };

      const created = await prisma.source.upsert({
        where: { url: data.url },
        update: data,
        create: data,
      });

      results.push(created);
    } catch (e: any) {
      errors.push({
        index: i,
        name: input?.name,
        url: input?.url,
        message: e.message || 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    success: true,
    created: results.length,
    errors,
    items: results,
  });
}

