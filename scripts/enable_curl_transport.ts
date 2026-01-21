
import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';

const prisma = new PrismaClient();

const TARGET_SOURCES = [
  '国防科技大学-通知公告',
  '武汉大学-招生动态',
  '浙江大学-通知公告'
];

async function main() {
  console.log('=== Enable Curl Transport for 3 Sources ===');
  
  // 1. Update Configuration
  for (const sourceName of TARGET_SOURCES) {
    console.log(`\n>>> Processing: ${sourceName}`);
    
    const source = await prisma.source.findFirst({ where: { name: sourceName } });
    if (!source) {
      console.error(`Source ${sourceName} not found!`);
      continue;
    }

    let crawlConfig: any = {};
    try {
      crawlConfig = JSON.parse(source.crawlConfig || '{}');
    } catch (e) {
    }

    // Set transport to curl
    crawlConfig.transport = 'curl';
    
    // Clear lastError if it's an auto-disable error
    let newLastError = source.lastError;
    if (newLastError && (newLastError.includes('AutoDisabled') || newLastError.includes('TLSorWAFBlocked'))) {
        newLastError = null;
    }

    await prisma.source.update({
      where: { id: source.id },
      data: {
        crawlConfig: JSON.stringify(crawlConfig),
        isActive: true,
        fetchIntervalMinutes: 120,
        lastError: newLastError
      }
    });
    console.log('Updated crawlConfig.transport="curl" and enabled source.');
  }

  // 2. Dry Run Verification
  console.log('\n\n=== Dry Run Verification ===');
  const results: any[] = [];

  for (const sourceName of TARGET_SOURCES) {
     console.log(`\n--- Dry Run: ${sourceName} ---`);
     let runStats: any = {};
     let runError = null;
     let transportUsed = 'unknown';

     try {
       // We can't easily capture the console log here to confirm transport=curl, 
       // but we can infer it from success if previous undici failed.
       // Actually, the user asked to check logs. We will see them in stdout.
       const { stats } = await ingestAll({ dryRun: true, sourceName });
       runStats = stats;
     } catch (e: any) {
       console.error('Dry Run Failed:', e);
       runError = e.message;
     }

     // Check final status
     const refreshedSource = await prisma.source.findFirst({ where: { name: sourceName } });
     const config = JSON.parse(refreshedSource?.crawlConfig || '{}');
     transportUsed = config.transport || 'undici';

     results.push({
       sourceName,
       transport: transportUsed,
       fetched: runStats.fetched || 0,
       upserted: runStats.upserted || 0,
       errors: runStats.errors || 0,
       isActiveAfter: refreshedSource?.isActive,
       lastError: runError || refreshedSource?.lastError
     });
  }

  // 3. Final Report
  console.log('\n\n=== Final Report ===');
  console.log('| sourceName | transport | fetched | upserted | errors | isActive(after) |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.sourceName} | ${r.transport} | ${r.fetched} | ${r.upserted} | ${r.errors} | ${r.isActiveAfter} |`);
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
