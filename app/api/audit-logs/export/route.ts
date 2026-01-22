/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';

async function getLogsFromRequest(request: Request) {
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

  return logs;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'xlsx';

  const logs = await getLogsFromRequest(request);

  const rows = logs.map(log => ({
    id: log.id,
    itemId: log.itemId,
    title: log.item?.title || '',
    action: log.action,
    result: log.result || '',
    reviewer: log.reviewer,
    isImportant: log.isImportant ? '是' : '否',
    createdAt: log.createdAt.toISOString(),
  }));

  if (format === 'pdf') {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Uint8Array[] = [];
      doc.on('data', chunk => {
        chunks.push(chunk);
      });
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', err => {
        reject(err);
      });

      doc.fontSize(16).text('审核记录导出', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);

      rows.forEach(row => {
        doc.text(`时间: ${row.createdAt}`);
        doc.text(`审核结果: ${row.result}`);
        doc.text(`操作: ${row.action}`);
        doc.text(`审核人: ${row.reviewer}`);
        doc.text(`重要: ${row.isImportant}`);
        doc.text(`标题: ${row.title}`);
        doc.moveDown();
      });

      doc.end();
    });

    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="audit-logs.pdf"',
      },
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'AuditLogs');
  const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(excelBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="audit-logs.xlsx"',
    },
  });
}

