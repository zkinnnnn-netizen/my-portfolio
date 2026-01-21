
import { ingestAll } from '../lib/ingest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Running Ingest Dry Run...');
  
  // Ensure we have at least one active source
  const count = await prisma.source.count({ where: { isActive: true } });
  console.log(`Active sources: ${count}`);
  
  if (count === 0) {
      console.log("No active sources. Activating one for test...");
      const first = await prisma.source.findFirst();
      if (first) {
          await prisma.source.update({ where: { id: first.id }, data: { isActive: true } });
          console.log(`Activated ${first.name}`);
      } else {
          console.error("No sources found at all.");
          return;
      }
  }

  const { stats } = await ingestAll({ dryRun: true });
  console.log('Final Stats:', stats);
  
  if (stats.fetched === 0) {
    console.log('⚠️ No items fetched. Check source URLs or network.');
  } else if (stats.skippedByLimit > 0) {
    console.log('ℹ️ Some items were skipped due to push limits (expected in dry-run).');
  } else {
    console.log('✅ Ingest dry run completed successfully.');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
