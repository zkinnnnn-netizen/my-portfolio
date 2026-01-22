import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAdminPassword } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Simple auth check using admin password
  const adminPassword = getAdminPassword();
  const authHeader = request.headers.get('x-admin-password');
  
  if (!adminPassword || authHeader !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sourceCount = await prisma.source.count();
    const activeCount = await prisma.source.count({
      where: { isActive: true }
    });
    
    const dbUrl = process.env.DATABASE_URL || '';
    // Hide sensitive info but show structure
    const dbUrlMasked = dbUrl.replace(/:[^:@]+@/, ':****@');

    return NextResponse.json({
      ok: true,
      sourceCount,
      activeCount,
      dbUrlMasked,
      timestamp: new Date().toISOString()
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ 
      ok: false, 
      error: errorMessage 
    }, { status: 500 });
  }
}
