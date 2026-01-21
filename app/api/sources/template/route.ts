import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const headers = [
  'name',
  'type',
  'url',
  'regionTag',
  'categoryTag',
  'priority',
  'isActive',
  'fetchIntervalMinutes',
];

const sampleRows = [
  {
    name: 'MIT 招生办博客',
    type: 'RSS',
    url: 'https://mitadmissions.org/feed/',
    regionTag: 'US',
    categoryTag: '留学',
    priority: 5,
    isActive: true,
    fetchIntervalMinutes: 60,
  },
  {
    name: '清华大学本科招生网',
    type: 'HTML',
    url: 'https://join-tsinghua.edu.cn/tzgg.htm',
    regionTag: 'CN',
    categoryTag: '升学',
    priority: 5,
    isActive: true,
    fetchIntervalMinutes: 60,
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'xlsx';

  if (format === 'csv') {
    const lines: string[] = [];
    lines.push(headers.join(','));
    for (const row of sampleRows) {
      const values = headers.map(key => {
        const value = (row as any)[key];
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') {
          const escaped = value.replace(/"/g, '""');
          if (escaped.includes(',') || escaped.includes('"')) {
            return `"${escaped}"`;
          }
          return escaped;
        }
        return String(value);
      });
      lines.push(values.join(','));
    }
    const csv = lines.join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="source-template.csv"',
      },
    });
  }

  const worksheetData = [headers, ...sampleRows.map(row => headers.map(key => (row as any)[key] ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SourcesTemplate');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as any;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="source-template.xlsx"',
    },
  });
}

