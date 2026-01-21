
import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const prisma = new PrismaClient();

const TARGET_SOURCES = [
  '国防科技大学-通知公告',
  '武汉大学-招生动态',
  '浙江大学-通知公告'
];

async function main() {
  console.log('=== Fix SocketError/403 for 3 Sources ===');
  const results: any[] = [];

  for (const sourceName of TARGET_SOURCES) {
    console.log(`\n\n>>> Processing: ${sourceName}`);
    
    // A) Read Source
    const source = await prisma.source.findFirst({ where: { name: sourceName } });
    if (!source) {
      console.error(`Source ${sourceName} not found!`);
      continue;
    }
    
    let crawlConfig: any = {};
    try {
      crawlConfig = JSON.parse(source.crawlConfig || '{}');
    } catch (e) {}

    console.log('--- A) Current Source Info ---');
    console.log(JSON.stringify({
      id: source.id,
      name: source.name,
      url: source.url,
      isActive: source.isActive,
      fetchIntervalMinutes: source.fetchIntervalMinutes,
      lastError: source.lastError,
      lastRunStats: source.lastRunStats,
      crawlConfig: crawlConfig
    }, null, 2));

    // B) Curl Check
    let curlStatus = 'N/A';
    if (crawlConfig.listUrls && crawlConfig.listUrls.length > 0) {
      const listUrl = crawlConfig.listUrls[0];
      const tmpFile = `/tmp/src_${source.id.substring(0, 8)}.html`;
      console.log(`--- B) Curl Check: ${listUrl} ---`);
      
      try {
        const cmd = `curl -sS -D - -o ${tmpFile} -L "${listUrl}" | head -n 20`;
        const { stdout } = await execPromise(cmd);
        console.log(stdout);
        
        // Extract status code
        const match = stdout.match(/HTTP\/1\.[01] (\d+)/);
        if (match) curlStatus = match[1];
        
        const { stdout: wcOut } = await execPromise(`wc -c ${tmpFile}`);
        console.log(`Body Size: ${wcOut.trim()}`);
      } catch (e: any) {
        console.error('Curl failed:', e.message);
        curlStatus = 'FAIL';
      }
    } else {
      console.log('No listUrl to curl.');
    }

    // C) Update Headers
    console.log('--- C) Updating Headers ---');
    // Extract root domain for Referer
    let referer = '';
    try {
      const u = new URL(source.url);
      referer = `${u.protocol}//${u.host}/`;
    } catch (e) {
      referer = source.url; // Fallback
    }

    const newHeaders = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": referer,
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    };
    
    crawlConfig.headers = { ...(crawlConfig.headers || {}), ...newHeaders };
    
    await prisma.source.update({
      where: { id: source.id },
      data: { crawlConfig: JSON.stringify(crawlConfig) }
    });
    console.log('Headers updated in DB.');

    // D) Dry Run
    console.log('--- D) Dry Run ---');
    let runStats: any = {};
    let runError = null;
    let fetchedUrls: string[] = [];
    
    try {
      // Run ingestAll for this source
      const { stats, results: ingestResults } = await ingestAll({ dryRun: true, sourceName: sourceName });
      runStats = stats;
      
      // Extract candidate URLs if fetched > 0
      if (stats.fetched > 0 && ingestResults && ingestResults.length > 0) {
        // ingestResults structure depends on ingest.ts, usually it returns items
        // Let's assume results contains the items
        // Actually ingest.ts: processHTML -> results.push(item)
        fetchedUrls = ingestResults.slice(0, 5).map((r: any) => r.url);
      }
    } catch (e: any) {
      console.error('Dry Run Failed:', e);
      runError = e.message;
    }

    // Print dry run summary
    console.log('Dry Run Stats:', runStats);
    if (runError) console.log('Dry Run Error:', runError);
    if (fetchedUrls.length > 0) {
      console.log('Top 5 Fetched URLs:', fetchedUrls);
    }

    // E) Judgement & Stop Loss
    console.log('--- E) Judgement ---');
    let finalIsActive = false;
    let finalLastError = null;
    let finalStatus = 'UNKNOWN';
    
    // Check outcome
    // Need to re-read source to see if ingestAll wrote to lastError (it does even in dryRun if it catches error)
    const refreshedSource = await prisma.source.findUnique({ where: { id: source.id } });
    const effectiveError = runError || (refreshedSource?.lastError ? refreshedSource.lastError : null);
    const hasError = (runStats.errors > 0) || (effectiveError && effectiveError.trim() !== '');
    
    if (!hasError && runStats.fetched > 0) {
      console.log('SUCCESS: Source recovered!');
      finalIsActive = true;
      finalStatus = 'RECOVERED';
      
      // Update DB
      // Clear lastError only if it was an auto-disable message or null
      // The user said: "lastError 保持不变或清空为 null（仅当 lastError 是 AutoDisabled:... 这类自动止损信息时清空）"
      let newLastError = refreshedSource?.lastError;
      if (newLastError && newLastError.includes('AutoDisabled:')) {
          newLastError = null; // Clear it
      }
      
      await prisma.source.update({
        where: { id: source.id },
        data: {
          isActive: true,
          fetchIntervalMinutes: 120,
          lastError: newLastError
        }
      });
      finalLastError = newLastError;

    } else {
      console.log('FAIL: Still has errors or fetched=0.');
      finalStatus = 'FAILED';
      finalIsActive = false;
      
      const nowIso = new Date().toISOString();
      const listUrl = crawlConfig.listUrls?.[0] || 'N/A';
      const reason = `TLSorWAFBlocked:UNDICI_SOCKET_OR_403 at ${nowIso} url=${listUrl} (curl_ok_node_fail)`;
      
      await prisma.source.update({
        where: { id: source.id },
        data: {
          isActive: false,
          fetchIntervalMinutes: 1440,
          lastError: reason
        }
      });
      finalLastError = reason;
    }

    // F) Record for report
    results.push({
      sourceName,
      curlStatus,
      nodeResult: hasError ? `Error (${runStats.errors})` : 'OK',
      fetched: runStats.fetched || 0,
      upserted: runStats.upserted || 0,
      isActiveAfter: finalIsActive,
      lastErrorAfter: finalLastError,
      status: finalStatus
    });
  }

  // F) Final Report
  console.log('\n\n=== Final Report ===');
  console.log('| sourceName | curlStatus | nodeResult | fetched | upserted | isActive(after) | lastError(after) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.sourceName} | ${r.curlStatus} | ${r.nodeResult} | ${r.fetched} | ${r.upserted} | ${r.isActiveAfter} | ${r.lastErrorAfter ? r.lastErrorAfter.substring(0, 30) + '...' : 'null'} |`);
  }
  
  console.log('\nConclusions:');
  for (const r of results) {
    console.log(`- ${r.sourceName}: ${r.status}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
