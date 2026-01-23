
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';

const prisma = new PrismaClient();

const TARGETS = ["吉林大学-通知公告", "湖南大学-通知公告"];

async function main() {
  console.log('=== A1: Configuration & Last Status ===');
  for (const name of TARGETS) {
    const source = await prisma.source.findFirst({ where: { name } });
    if (!source) {
      console.log(`Source not found: ${name}`);
      continue;
    }
    console.log(`\n--- ${name} ---`);
    console.log(`ID: ${source.id}`);
    console.log(`Active: ${source.isActive}`);
    console.log(`URL: ${source.url}`);
    console.log(`Type: ${source.type}`);
    console.log(`Interval: ${source.fetchIntervalMinutes}`);
    console.log(`LastError: ${source.lastError}`);
    console.log(`LastRunStats: ${JSON.stringify(source.lastRunStats)}`);
    try {
      console.log(`CrawlConfig:`, JSON.stringify(JSON.parse(source.crawlConfig || '{}'), null, 2));
    } catch {
      console.log(`CrawlConfig: INVALID JSON`);
    }
  }

  console.log('\n=== A2: Dry-Run Diagnostics ===');
  for (const name of TARGETS) {
    console.log(`\n>>> Running Dry-Run for ${name}...`);
    try {
      // We rely on standard output logging for diagnosis
      const { stats } = await ingestAll({ dryRun: true, sourceName: name });
      console.log(`Stats:`, stats);
    } catch (e: any) {
      console.error(`Dry-Run failed for ${name}:`, e.message);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
