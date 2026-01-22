/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  const rows = await prisma.source.findMany({
    orderBy: { priority: 'desc' }
  });
  const sources = rows.map((row: any) => {
    let stats: any = {};
    if (row.lastRunStats) {
      try {
        stats = JSON.parse(row.lastRunStats);
      } catch (e) {
        stats = {};
      }
    }
    const parsedStats = {
      fetched: stats.fetched || 0,
      upserted: stats.upserted || 0,
      pushed: stats.pushed || 0,
      dedupSkipped: stats.dedupSkipped || 0,
      skippedByLimit: stats.skippedByLimit || 0,
      skippedTooOld: stats.skippedTooOld || 0,
      errors: stats.errors || 0,
    };
    return {
      ...row,
      stats: parsedStats,
    };
  });
  return NextResponse.json(sources);
}

export async function POST(request: Request) {
  const body = await request.json();
  try {
    const source = await prisma.source.create({
      data: {
        name: body.name,
        type: body.type, // String in SQLite
        url: body.url,
        regionTag: body.regionTag,
        categoryTag: body.categoryTag,
        priority: parseInt(body.priority),
        isActive: body.isActive ?? true,
        fetchIntervalMinutes: parseInt(body.fetchIntervalMinutes || '60')
      }
    });
    return NextResponse.json(source);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
