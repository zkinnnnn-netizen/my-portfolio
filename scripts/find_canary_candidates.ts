
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import prisma from '../lib/prisma';

async function main() {
  // Find sources with successful upserts in the last 7 days and no errors in their last run
  const sources = await prisma.source.findMany({
    where: {
      isActive: true,
    }
  });

  const candidates = [];

  for (const source of sources) {
    if (!source.lastRunStats) continue;
    
    try {
      const stats = typeof source.lastRunStats === 'string' 
        ? JSON.parse(source.lastRunStats) 
        : source.lastRunStats;

      if (stats.errors === 0 && stats.upserted > 0) {
        candidates.push({
          name: source.name,
          upserted: stats.upserted,
          fetched: stats.fetched
        });
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  // Sort by upserted count desc
  candidates.sort((a, b) => b.upserted - a.upserted);

  console.log('Top Candidates:');
  candidates.slice(0, 15).forEach(c => {
    console.log(`'${c.name}', // Upserted: ${c.upserted}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
