
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

// 1. Load env
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

interface IngestStats {
    fetched: number;
    upserted: number;
    errors: number;
    skippedTooOld: number;
    skippedByLimit: number;
}

// Helper to calculate display width of string (approximate for alignment)
function getDisplayWidth(str: string): number {
    let width = 0;
    for (const char of str) {
        // Simple check for full-width characters (Chinese, etc.)
        // This range covers most CJK characters
        if (char.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/)) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

function truncateString(str: string, maxLen: number): string {
    if (!str) return '';
    let result = '';
    let len = 0;
    for (const char of str) {
        const charLen = char.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/) ? 2 : 1;
        if (len + charLen > maxLen) {
            result += '…';
            break;
        }
        result += char;
        len += charLen;
    }
    return result;
}

function padString(str: string, width: number): string {
    const w = getDisplayWidth(str);
    if (w >= width) return str;
    return str + ' '.repeat(width - w);
}

function formatTime(date: Date | null | undefined): string {
    if (!date) return 'Never';
    // Simple HH:mm for compact tables, full date for others
    return new Intl.DateTimeFormat('zh-CN', { 
        timeZone: 'Asia/Shanghai', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    }).format(date);
}

async function main() {
    // console.log('Generating Health Report...');
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Source Statistics
    const allSources = await prisma.source.findMany();
    const activeSources = allSources.filter(s => s.isActive);
    const disabledSources = allSources.filter(s => !s.isActive);

    const sourceStats = activeSources.map(s => {
        let stats: IngestStats = { fetched: 0, upserted: 0, errors: 0, skippedTooOld: 0, skippedByLimit: 0 };
        try {
            if (s.lastRunStats) {
                const parsed = JSON.parse(s.lastRunStats as string);
                // Ensure all fields exist
                stats = { ...stats, ...parsed };
            }
        } catch (e) { }
        return {
            name: s.name,
            lastFetchedAt: s.lastFetchedAt,
            lastError: s.lastError,
            stats
        };
    });

    // Top Error Sources (errors > 0 or lastError not null)
    const errorSources = sourceStats
        .filter(s => s.stats.errors > 0 || s.lastError)
        .sort((a, b) => {
             // Sort by error count desc, then by lastFetchedAt asc (stale)
             if (b.stats.errors !== a.stats.errors) return b.stats.errors - a.stats.errors;
             return (a.lastFetchedAt?.getTime() || 0) - (b.lastFetchedAt?.getTime() || 0);
        })
        .slice(0, 5); // Max 5

    // 2. Item Statistics (Last 24h)
    const newItems = await prisma.item.count({ where: { createdAt: { gte: oneDayAgo } } });
    const pendingItems = await prisma.item.count({ where: { status: 'PENDING', createdAt: { gte: oneDayAgo } } });
    const approvedItems = await prisma.item.count({ where: { status: 'APPROVED', createdAt: { gte: oneDayAgo } } });
    const skippedItems = await prisma.item.count({ where: { status: 'SKIPPED', createdAt: { gte: oneDayAgo } } });

    // 3. Push Audit (Last 24h)
    let pushSuccess = 0;
    let pushError = 0;
    try {
         const audits = await prisma.auditLog.findMany({
             where: { 
                 action: 'PUSH',
                 createdAt: { gte: oneDayAgo } 
             }
         });
         pushSuccess = audits.filter(a => a.result === 'SUCCESS').length;
         pushError = audits.filter(a => a.result !== 'SUCCESS').length;
    } catch(e) {
        // Fallback: Use Item.pushedAt for success, 0 for error
        pushSuccess = await prisma.item.count({ where: { pushedAt: { gte: oneDayAgo } } });
        pushError = 0; 
    }

    // --- Output Generation ---
    const lines: string[] = [];

    // Header
    lines.push('📊 招生资讯系统健康日报');
    const timeStr = new Intl.DateTimeFormat('zh-CN', { 
        timeZone: 'Asia/Shanghai', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
    }).format(now);
    lines.push(`时间（北京时间）：${timeStr}`);
    lines.push('––––––––––');

    // Overview
    lines.push('概览：');
    lines.push(`✅ 活跃源：${activeSources.length}`);
    lines.push(`📴 已禁用源：${disabledSources.length}`);
    lines.push(`🆕 24小时新增条目：${newItems}`);
    lines.push(`📤 24小时推送成功：${pushSuccess}`);
    lines.push(`❌ 24小时推送失败：${pushError}`);
    lines.push('––––––––––');

    // Top Error Sources
    lines.push('⚠️ 异常源 Top（只列 errors>0 或 lastError 非空，最多 5 条）：');
    if (errorSources.length === 0) {
        lines.push('（无异常）');
    } else {
        errorSources.forEach((s, i) => {
            const errSummary = s.lastError ? truncateString(s.lastError, 40) : 'Unknown Error';
            // 1. Source Name｜Errors=｜Fetched=｜上次运行=｜LastError
            // Using full-width pipe ｜ as separator to avoid Markdown table issues
            const time = formatTime(s.lastFetchedAt);
            lines.push(`${i + 1}. ${s.name}｜Errors=${s.stats.errors}｜Fetched=${s.stats.fetched}｜上次运行=${time}｜${errSummary}`);
        });
    }
    lines.push('––––––––––');

    // Item Status
    lines.push('🧾 条目状态（24h）：');
    lines.push(`待审核 Pending：${pendingItems}`);
    lines.push(`已通过 Approved：${approvedItems}`);
    lines.push(`已跳过 Skipped：${skippedItems}`);
    lines.push('––––––––––');

    // Active Sources Summary (Code block pseudo-table)
    lines.push('📈 活跃源最近一次运行摘要（最多 12 条）：');
    // Sort by recent activity
    const recentSources = sourceStats
        .sort((a, b) => (b.lastFetchedAt?.getTime() || 0) - (a.lastFetchedAt?.getTime() || 0))
        .slice(0, 12);
    
    // Header for code block
    // Name(14) F(4) U(4) Old(4) Limit(6) Err(4)
    // Adjust widths: Name: 14 (12 chars + ... = ~14-16 visual width)
    // Let's use fixed visual widths
    
    // Header
    const colName = padString('源名(截断到12字)', 16);
    const colF = 'Fet'.padEnd(4);
    const colU = 'Ups'.padEnd(4);
    const colOld = 'Old'.padEnd(4);
    const colLim = 'Limit'.padEnd(6);
    const colErr = 'Err'.padEnd(4);

    const codeBlockLines: string[] = [];
    codeBlockLines.push(`${colName}  ${colF} ${colU} ${colOld} ${colLim} ${colErr}`);

    recentSources.forEach(s => {
        const name = truncateString(s.name, 24); // 12 Chinese chars = 24 width
        const namePadded = padString(name, 16);
        const f = s.stats.fetched.toString().padEnd(4);
        const u = s.stats.upserted.toString().padEnd(4);
        const o = s.stats.skippedTooOld.toString().padEnd(4);
        const l = s.stats.skippedByLimit.toString().padEnd(6);
        const e = s.stats.errors.toString().padEnd(4);
        codeBlockLines.push(`${namePadded}  ${f} ${u} ${o} ${l} ${e}`);
    });

    lines.push('```');
    lines.push(codeBlockLines.join('\n'));
    lines.push('```');

    // Final Output
    const reportText = lines.join('\n');
    
    // Write to file
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir);
    }
    fs.writeFileSync(path.join(tmpDir, 'health_report.md'), reportText);

    // Print to console
    console.log(reportText);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
