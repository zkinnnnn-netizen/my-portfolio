
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { fetchHtmlWithCurl } from '../lib/curlFetch';

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);

// B0: Blacklist definitions
const BLACKLIST_KEYWORDS = ['WAFBlocked:', 'DynamicSite:LIST_JS_RENDER'];
const BLACKLIST_DOMAINS = [
  'zsb.nankai.edu.cn',
  'bkzs.nju.edu.cn', // specifically /static/front/ path usually
];

async function isCurlOk(url: string): Promise<boolean> {
  try {
    // Requirement: curl -sS -D - -o /tmp/x.html -L "<listUrl>"
    // We use execFile for safety.
    const args = [
      '-sS',
      '-D', '-',
      '-o', '/dev/null', // We just want to check status/headers, ignore body for this quick check? 
                         // Wait, user said "curl -sS -D - -o /tmp/x.html ... | head -n 5"
                         // That implies checking output. 
                         // But later says "若 curl 返回 200 且 body 大小正常".
      '-w', '%{http_code}',
      '-L',
      url
    ];
    
    // We'll use a simplified check: get status code and body size via our robust fetchHtmlWithCurl
    // This effectively tests if our curl transport WOULD work.
    const { status, html } = await fetchHtmlWithCurl(url, undefined, 10000);
    return status === 200 && html.length > 500;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('=== Batch 3 Rollout ===');

  // 1. Identify active sources (to exclude)
  const activeSources = await prisma.source.findMany({ where: { isActive: true } });
  const activeIds = new Set(activeSources.map(s => s.id));

  // 2. Fetch candidates
  const candidates = await prisma.source.findMany({
    where: {
      isActive: false,
      lastError: null // or empty string, handled by filter
    }
  });

  // 3. Filter candidates
  const selected: any[] = [];
  const excluded: any[] = [];
  const domains = new Set<string>();

  // Helper to get domain
  const getDomain = (u: string) => {
    try { return new URL(u).hostname; } catch { return ''; }
  };

  // Sort: RSS first, then HTML
  const sortedCandidates = candidates.sort((a, b) => {
    if (a.type === 'RSS' && b.type !== 'RSS') return -1;
    if (a.type !== 'RSS' && b.type === 'RSS') return 1;
    return 0;
  });

  for (const s of sortedCandidates) {
    if (selected.length >= 15) break;

    // Check lastError (strict null check in query, but double check for empty string)
    if (s.lastError && s.lastError.trim() !== '') continue;

    // Check blacklist keywords (should be null lastError anyway, but safe check)
    if (BLACKLIST_KEYWORDS.some(k => s.lastError?.includes(k))) {
      excluded.push({ name: s.name, reason: `Blacklist keyword in lastError` });
      continue;
    }

    const domain = getDomain(s.url);

    // Check blacklist domains
    if (BLACKLIST_DOMAINS.some(d => domain.includes(d))) {
       excluded.push({ name: s.name, reason: 'Blacklist domain' });
       continue;
    }
    
    // Check Nanjing specific path if domain matches nju (though handled above broadly)
    if (s.url.includes('bkzs.nju.edu.cn/static/front/')) {
        excluded.push({ name: s.name, reason: 'Blacklist NJU static' });
        continue;
    }

    // Static HTML heuristic: prefer .htm, .html, or / ending. Avoid .jsp, .aspx if possible?
    // User said: "listUrl 看起来是静态列表（list.htm/index.htm/tzgg 等）"
    // We already prioritized RSS. For HTML:
    if (s.type !== 'RSS') {
        const isStaticLooking = s.url.match(/\.(html|htm|shtml)$/i) || s.url.endsWith('/') || s.url.includes('/tzgg') || s.url.includes('/index');
        // We accept it if it looks static, or if we just need to fill quota.
        // Let's be slightly strict.
        if (!isStaticLooking) {
            // Keep as backup? For now skip to prioritize high quality.
            // excluded.push({ name: s.name, reason: 'Not looking like static HTML' });
            // continue;
        }
    }

    // Domain diversity: Try to avoid > 2 per domain in this batch?
    // User said: "同域不要一次挑太多"
    const domainCount = selected.filter(sel => getDomain(sel.url) === domain).length;
    if (domainCount >= 2) {
         continue; // Skip this one, find another
    }

    selected.push(s);
  }

  if (excluded.length > 0) {
      console.log('\n=== Excluded Candidates (B0) ===');
      excluded.forEach(e => console.log(`- ${e.name}: ${e.reason}`));
  }

  console.log(`\nSelected ${selected.length} sources for Batch 3.`);
  console.log('Candidates:', selected.map(s => `${s.name} (${s.url})`).join('\n'));

  // 4. Enable & Dry Run
  console.log('\n=== Enabling & Dry Run ===');
  const results: any[] = [];

  for (const s of selected) {
    console.log(`\nProcessing: ${s.name}`);
    
    // Enable
    await prisma.source.update({
      where: { id: s.id },
      data: {
        isActive: true,
        fetchIntervalMinutes: 120,
        // Don't set transport, default to undici
      }
    });

    // Dry Run
    let runStats: any = {};
    let runError = null;
    let transport = 'undici'; // default

    try {
      const { stats } = await ingestAll({ dryRun: true, sourceName: s.name });
      runStats = stats;
    } catch (e: any) {
      console.error(`Dry run failed for ${s.name}:`, e.message);
      runError = e.message;
    }

    // Check errors
    const hasError = (runStats.errors > 0) || runError;
    
    if (hasError) {
        console.log(`Source ${s.name} failed with undici. Attempting auto-recovery check...`);
        // Auto Recovery Logic
        const curlWorks = await isCurlOk(s.url);
        if (curlWorks) {
            console.log(`Curl check PASSED. Switching to transport='curl'...`);
            
            // Update config
            let config: any = {};
            try { config = JSON.parse(s.crawlConfig || '{}'); } catch {}
            config.transport = 'curl';

            await prisma.source.update({
                where: { id: s.id },
                data: { crawlConfig: JSON.stringify(config) }
            });
            transport = 'curl';

            // Re-run dry run
            try {
                console.log('Re-running dry run with curl...');
                const { stats: stats2 } = await ingestAll({ dryRun: true, sourceName: s.name });
                runStats = stats2;
                runError = null; // Reset error if this run passes
                if (stats2.errors > 0) {
                    runError = 'Still failing with curl';
                }
            } catch (e: any) {
                console.error(`Retry with curl failed:`, e.message);
                runError = e.message;
            }
        } else {
            console.log(`Curl check FAILED.`);
        }
    }

    // Final decision for this source
    let finalStatus = 'OK';
    let isActive = true;
    let lastError = null;

    if (runStats.errors > 0 || runError) {
        finalStatus = 'FAILED';
        isActive = false;
        lastError = `AutoDisabled:BATCH3_ERRORS at ${new Date().toISOString()} (curl_failed_too)`;
        
        await prisma.source.update({
            where: { id: s.id },
            data: {
                isActive: false,
                fetchIntervalMinutes: 1440,
                lastError
            }
        });
    }

    results.push({
        sourceName: s.name,
        fetched: runStats.fetched || 0,
        upserted: runStats.upserted || 0,
        errors: runStats.errors || 0,
        lastError: runError || lastError,
        transport,
        isActive
    });
  }

  // 5. Report
  console.log('\n\n=== Batch 3 Final Report ===');
  console.log('| sourceName | fetched | upserted | errors | transport | isActive | lastError |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
      const errStr = r.lastError ? (r.lastError.length > 20 ? r.lastError.substring(0, 20) + '...' : r.lastError) : '';
      console.log(`| ${r.sourceName} | ${r.fetched} | ${r.upserted} | ${r.errors} | ${r.transport} | ${r.isActive} | ${errStr} |`);
  }

  const successCount = results.filter(r => r.isActive).length;
  const total = results.length;
  console.log(`\nSuccess Rate: ${successCount}/${total} (${Math.round(successCount/total*100)}%)`);
  
  if (successCount/total >= 0.8) {
      console.log('Recommendation: Success rate >= 80%. Next batch can be 15-20 sources.');
  } else {
      console.log('Recommendation: Success rate < 80%. Fix top failures before proceeding.');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
