
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sources = await prisma.source.findMany({ where: { isActive: true } });
  
  console.log('\n=== Final Report ===');
  console.log('| sourceName | transport | fetched | upserted | errors | lastError |');
  console.log('|---|---|---|---|---|---|');

  let successCount = 0;
  let failures: any[] = [];

  for (const s of sources) {
    const config = JSON.parse(s.crawlConfig || '{}');
    let stats: any = s.lastRunStats;
    if (typeof stats === 'string') {
        try { stats = JSON.parse(stats); } catch { stats = {}; }
    }
    if (!stats) stats = {};
    
    const fetched = stats.fetched || 0;
    const upserted = stats.upserted || 0;
    const errors = stats.errors || 0;

    const transport = config.transport || 'undici';
    
    // Clean up lastError for display
    let errorDisplay = s.lastError ? s.lastError.substring(0, 30) + '...' : '';
    
    console.log(`| ${s.name} | ${transport} | ${fetched} | ${upserted} | ${errors} | ${errorDisplay} |`);

    // Success criteria: fetched > 0 and errors == 0
    if (fetched > 0 && errors === 0) {
      successCount++;
    } else {
      failures.push({ name: s.name, reason: s.lastError || `fetched=${fetched}, errors=${errors}` });
    }
  }

  const total = sources.length;
  const rate = total > 0 ? (successCount / total * 100).toFixed(1) : '0.0';

  console.log(`\nTotal Active Sources: ${total}`);
  console.log(`Success Rate: ${successCount}/${total} (${rate}%)`);
  
  if (failures.length > 0) {
    console.log('\nTop Failures:');
    failures.slice(0, 3).forEach(f => console.log(`- ${f.name}: ${f.reason}`));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
