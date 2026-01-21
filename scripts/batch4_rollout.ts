
import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';
import { fetchHtmlWithCurl } from '../lib/curlFetch';
import { URL } from 'url';

const prisma = new PrismaClient();

const EXCLUDED_DOMAINS = ['zsb.nankai.edu.cn', 'bkzs.nju.edu.cn'];
const BATCH_SIZE = 18;

async function main() {
  console.log('=== B0: Generating Exclusion List ===');
  const allSources = await prisma.source.findMany({
    where: { isActive: false }
  });

  const candidates: any[] = [];
  const excluded: any[] = [];

  for (const s of allSources) {
    // 1. Check lastError
    if (s.lastError && (s.lastError.includes('WAFBlocked') || s.lastError.includes('DynamicSite'))) {
      excluded.push({ name: s.name, reason: s.lastError });
      continue;
    }

    // 2. Check Excluded Domains
    try {
      const urlObj = new URL(s.url);
      if (EXCLUDED_DOMAINS.some(d => urlObj.hostname.includes(d))) {
        excluded.push({ name: s.name, reason: `Excluded domain: ${urlObj.hostname}` });
        continue;
      }
      // Special check for NJU path
      if (s.url.includes('bkzs.nju.edu.cn/static/front/')) {
        excluded.push({ name: s.name, reason: 'Excluded path: bkzs.nju.edu.cn/static/front/' });
        continue;
      }
    } catch {
      excluded.push({ name: s.name, reason: 'Invalid URL' });
      continue;
    }

    // 3. Must be clean (lastError empty or null)
    if (s.lastError && s.lastError.trim() !== '') {
       // Only allow if it's not a severe error, but prompt asked for lastError to be null/empty
       // Let's stick to strict null/empty for "safe" rollout
       excluded.push({ name: s.name, reason: `Has lastError: ${s.lastError}` });
       continue;
    }

    candidates.push(s);
  }

  console.log(`Excluded count: ${excluded.length}`);
  if (excluded.length > 0) {
    console.log('Sample excluded:', excluded.slice(0, 5).map(e => `${e.name} (${e.reason})`));
  }

  console.log('\n=== B1: Selection (Max 2 per domain) ===');
  const domainMap = new Map<string, any[]>();
  for (const s of candidates) {
    try {
      const domain = new URL(s.url).hostname;
      if (!domainMap.has(domain)) domainMap.set(domain, []);
      domainMap.get(domain)?.push(s);
    } catch {}
  }

  const selected: any[] = [];
  // Prioritize RSS? (Type check)
  // We'll just pick up to 2 from each domain until we hit BATCH_SIZE
  
  for (const [domain, sources] of Array.from(domainMap.entries())) {
    if (selected.length >= BATCH_SIZE) break;
    
    // Sort: RSS first?
    sources.sort((a: any, b: any) => (a.type === 'RSS' ? -1 : 1));
    
    // Take max 2
    const toTake = sources.slice(0, 2);
    for (const s of toTake) {
      if (selected.length >= BATCH_SIZE) break;
      selected.push(s);
    }
  }

  console.log(`Selected ${selected.length} sources for Batch 4:`);
  selected.forEach(s => console.log(`- ${s.name} (${s.url})`));

  console.log('\n=== B2: Enabling Sources ===');
  for (const s of selected) {
    await prisma.source.update({
      where: { id: s.id },
      data: {
        isActive: true,
        fetchIntervalMinutes: 120,
        // Don't change crawlConfig transport default (undici)
      }
    });
  }

  console.log('\n=== B3: Dry-Run Verification ===');
  const results: any[] = [];

  for (const s of selected) {
    console.log(`\nTesting ${s.name}...`);
    try {
      const { stats } = await ingestAll({ dryRun: true, sourceName: s.name });
      results.push({
        source: s,
        stats,
        transport: 'undici' // Default
      });
    } catch (e: any) {
      console.error(`Error testing ${s.name}:`, e.message);
      results.push({
        source: s,
        stats: { fetched: 0, upserted: 0, errors: 1 },
        transport: 'undici',
        error: e.message
      });
    }
  }

  console.log('\n=== B4: Auto-Recovery / Stop-Loss ===');
  for (const r of results) {
    const { source, stats } = r;
    if (stats.errors > 0 || stats.fetched === 0) {
      console.log(`\nAttempting recovery for ${source.name} (fetched=${stats.fetched}, errors=${stats.errors})...`);
      
      // Curl check
      const listUrl = JSON.parse(source.crawlConfig || '{}').listUrls?.[0] || source.url;
      try {
        console.log(`Curl checking ${listUrl}...`);
        const { status, html } = await fetchHtmlWithCurl(listUrl, {}, 20000);
        console.log(`Curl status: ${status}, Body size: ${html.length}`);
        
        if (status === 200 && html.length > 1000) {
          console.log('Curl successful. Switching transport to curl...');
          const config = JSON.parse(source.crawlConfig || '{}');
          config.transport = 'curl';
          config.curlArgs = ['--connect-timeout', '10', '--max-time', '20'];
          
          await prisma.source.update({
            where: { id: source.id },
            data: { crawlConfig: JSON.stringify(config) }
          });
          
          // Re-test
          console.log('Re-running dry-run with curl...');
          const { stats: newStats } = await ingestAll({ dryRun: true, sourceName: source.name });
          console.log('New Stats:', newStats);
          
          if (newStats.errors === 0 && newStats.fetched > 0) {
            r.stats = newStats;
            r.transport = 'curl';
            r.recovered = true;
            console.log('Recovery Successful!');
          } else {
            console.log('Recovery Failed (still errors or empty). Disabling...');
            await disableSource(source, 'AutoDisabled:BATCH4_ERRORS (curl_failed_too)');
            r.finalStatus = 'Disabled';
          }
        } else {
           console.log(`Curl failed or body too small (status=${status}). Disabling...`);
           await disableSource(source, `AutoDisabled:BATCH4_ERRORS (curl_status=${status})`);
           r.finalStatus = 'Disabled';
        }
      } catch (e: any) {
        console.log(`Curl exception: ${e.message}. Disabling...`);
        await disableSource(source, `AutoDisabled:BATCH4_ERRORS (curl_exception)`);
        r.finalStatus = 'Disabled';
      }
    } else {
        r.finalStatus = 'Active';
    }
  }

  console.log('\n=== B5: Final Report ===');
  console.log('| sourceName | transport | fetched | upserted | errors | status |');
  console.log('|---|---|---|---|---|---|');
  
  let passed = 0;
  for (const r of results) {
    const status = r.finalStatus || 'Active';
    console.log(`| ${r.source.name} | ${r.transport} | ${r.stats.fetched} | ${r.stats.upserted} | ${r.stats.errors} | ${status} |`);
    if (status === 'Active' && r.stats.errors === 0 && r.stats.fetched > 0) {
        passed++;
    }
  }

  const rate = selected.length > 0 ? (passed / selected.length * 100).toFixed(1) : '0.0';
  console.log(`\nBatch Pass Rate: ${passed}/${selected.length} (${rate}%)`);
}

async function disableSource(source: any, reason: string) {
    await prisma.source.update({
        where: { id: source.id },
        data: {
            isActive: false,
            fetchIntervalMinutes: 1440,
            lastError: reason + ` at ${new Date().toISOString()}`
        }
    });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
