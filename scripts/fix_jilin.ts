
import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';

const prisma = new PrismaClient();

async function main() {
  console.log('=== A3: Applying Fixes for Jilin University ===');
  
  const jlu = await prisma.source.findFirst({ where: { name: '吉林大学-通知公告' } });
  if (jlu) {
    const config = JSON.parse(jlu.crawlConfig || '{}');
    // Fix: Tighten detailPattern to only match /info/ pages
    config.detailPattern = 'https://zsb\\.jlu\\.edu\\.cn/info/\\d+\\.html';
    // Ensure curl transport is kept (it was working for list page)
    config.transport = 'curl';
    // Ensure timeouts
    config.curlArgs = ['--connect-timeout', '10', '--max-time', '20'];

    await prisma.source.update({
      where: { id: jlu.id },
      data: {
        crawlConfig: JSON.stringify(config),
        isActive: true,
        fetchIntervalMinutes: 120,
        lastError: null // Clear previous error
      }
    });
    console.log('Fixed Jilin University configuration.');
  }

  // Hunan seemed fine (errors=0 in diagnosis), but let's ensure it has good timeouts if using curl, 
  // or just leave it if it's undici. Diagnosis showed it fetched 19 items fine.
  // We'll leave Hunan alone as it passed the diagnosis.

  console.log('\n=== Verification Dry-Run (Jilin) ===');
  try {
    const { stats } = await ingestAll({ dryRun: true, sourceName: '吉林大学-通知公告' });
    console.log('Jilin Stats:', stats);
  } catch (e: any) {
    console.error('Jilin Verification Failed:', e.message);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
