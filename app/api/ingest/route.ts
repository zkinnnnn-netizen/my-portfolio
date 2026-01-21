import { NextResponse } from 'next/server';
import { ingestAll } from '@/lib/ingest';

export async function POST(request: Request) {
  // Check token for cron or session for manual
  // Middleware handles auth/token check, but double check here if needed?
  // Middleware is robust.

  try {
    let dryRun = false;
    try {
        // Clone request because reading body might fail if already read or empty
        const clone = request.clone();
        const body = await clone.json();
        dryRun = !!body.dryRun;
    } catch(e) {
        // ignore
    }

    const { results, stats } = await ingestAll({ dryRun });
    return NextResponse.json({ success: true, count: results.length, stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
