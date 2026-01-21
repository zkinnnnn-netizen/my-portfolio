import { ingestAll } from '../lib/ingest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  let sourceId: string | null = null;
  let sourceName: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      sourceId = arg.slice('--id='.length);
    } else if (arg.startsWith('--name=')) {
      sourceName = arg.slice('--name='.length);
    }
  }

  if (!sourceId && !sourceName) {
    console.error('用法: npx tsx scripts/run_one_source.ts --id=<sourceId> 或 --name=<sourceName>');
    process.exit(1);
  }

  let source: any = null;
  if (sourceId) {
    source = await prisma.source.findUnique({ where: { id: sourceId } });
  } else if (sourceName) {
    source = await prisma.source.findFirst({ where: { name: sourceName } });
  }

  if (!source) {
    console.error('未找到指定的 Source');
    process.exit(1);
  }

  if (!source.isActive) {
    await prisma.source.update({
      where: { id: source.id },
      data: { isActive: true },
    });
    console.log(`已启用数据源: ${source.name}`);
  }

  console.log(`运行单源 Ingest: ${source.name} (${source.id})`);

  const { results, stats } = await ingestAll({ dryRun: false, sourceName: source.name });

  console.log('\n=== Ingest Summary ===');
  console.log(`source: ${source.name} (${source.id})`);
  console.log(`fetched: ${stats.fetched}`);
  console.log(`upserted: ${stats.upserted}`);
  console.log(`pushed: ${stats.pushed}`);
  console.log(`dedupSkipped: ${stats.dedupSkipped}`);
  console.log(`skippedByLimit: ${stats.skippedByLimit}`);
  console.log(`skippedTooOld: ${stats.skippedTooOld}`);
  console.log(`errors: ${stats.errors}`);

  console.log('\n=== Items (本次 upsert 的条目) ===');
  for (const item of results) {
    if (item.sourceId !== source.id) continue;
    const len = item.rawText ? item.rawText.length : 0;
    console.log(
      `- [${item.status}] ${item.title} | pushedAt=${item.pushedAt ? item.pushedAt.toISOString() : 'null'} | len=${len} | skipReason=${item.skipReason || 'null'}`
    );
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

