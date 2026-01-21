
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import prisma from '../lib/prisma';

async function main() {
  const sourceName = '中央民族大学-通知公告';
  console.log(`Searching for source: ${sourceName}`);

  const source = await prisma.source.findFirst({
    where: { name: sourceName }
  });

  if (!source) {
    console.error('Source not found');
    process.exit(1);
  }

  console.log(`Source found. ID: ${source.id}`);
  
  if (source.crawlConfig) {
      console.log('CrawlConfig:', JSON.stringify(source.crawlConfig, null, 2));
  } else {
      console.log('CrawlConfig: null');
  }

  const item = await prisma.item.findFirst({
    where: { 
      sourceId: source.id,
      pushedAt: { not: null }
    },
    orderBy: { pushedAt: 'desc' }
  });

  if (!item) {
    console.log('No pushed item found for this source.');
  } else {
    console.log('\n--- Most Recent Pushed Item ---');
    console.log(`ID: ${item.id}`);
    console.log(`Title: ${item.title}`);
    console.log(`URL: ${item.url}`);
    console.log(`CanonicalURL: ${item.canonicalUrl}`);
    console.log(`PublishedAt: ${item.publishedAt}`);
    console.log(`PushedAt: ${item.pushedAt}`);
    console.log(`SkipReason: ${item.skipReason}`);
    console.log(`Status: ${item.status}`);
    
    const digestPreview = item.digest ? item.digest.substring(0, 500) : 'NULL';
    console.log(`Digest (first 500 chars): ${digestPreview}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
