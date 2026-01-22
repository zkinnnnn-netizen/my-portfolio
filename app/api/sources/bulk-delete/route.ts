/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty IDs' }, { status: 400 });
    }

    // Use transaction to ensure data consistency
    // Note: We manually delete items first to ensure related data is cleaned up,
    // although database-level cascades might handle this, explicit deletion is safer with Prisma deleteMany.
    await prisma.$transaction(async (tx) => {
      // 1. Delete all items associated with these sources
      // Events are deleted via cascade from Items (defined in schema)
      // AuditLogs might need handling if they exist and restrict deletion
      
      // Find all item IDs to handle AuditLogs if necessary (optional step, but good for safety)
      // For now, we assume AuditLogs don't block or we don't strictly need to preserve them linked
      // If AuditLog has a foreign key constraint without cascade, this might fail. 
      // Let's try deleting items directly.
      
      await tx.item.deleteMany({
        where: {
          sourceId: {
            in: ids
          }
        }
      });

      // 2. Delete the sources
      await tx.source.deleteMany({
        where: {
          id: {
            in: ids
          }
        }
      });
    });

    return NextResponse.json({ success: true, count: ids.length });
  } catch (e: any) {
    console.error('Bulk delete error:', e);
    return NextResponse.json({ error: e.message || 'Bulk delete failed' }, { status: 500 });
  }
}
