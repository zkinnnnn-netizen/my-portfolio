import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import prisma from '../lib/prisma';

async function findCandidate() {
  console.log('🔍 Searching for push candidate (last 7 days)...');
  
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Try to find unpushed approved/pending item
  const item = await prisma.item.findFirst({
    where: {
      createdAt: { gte: sevenDaysAgo },
      status: { in: ['APPROVED', 'PENDING'] },
      pushedAt: null
    },
    orderBy: { createdAt: 'desc' },
    include: { source: true }
  });

  if (item) {
    console.log('✅ Found unpushed candidate:');
    console.log(`   ID: ${item.id}`);
    console.log(`   Title: ${item.title}`);
    console.log(`   Source: ${item.source.name}`);
    console.log(`   SourceName: ${item.source.name}`); // Redundant but for clarity
    console.log(`   PublishedAt: ${item.publishedAt}`);
    
    // Output for next step
    console.log(`\n👉 SUGGESTION: Modify scripts/canary_push.ts to only run source "${item.source.name}"`);
  } else {
    console.log('⚠️ No unpushed candidate found.');
    
    // 2. Find a recently pushed item to reset
    const pushedItem = await prisma.item.findFirst({
        where: {
            createdAt: { gte: sevenDaysAgo },
            status: { in: ['APPROVED', 'PENDING'] },
            pushedAt: { not: null }
        },
        orderBy: { pushedAt: 'desc' },
        include: { source: true }
    });

    if (pushedItem) {
        console.log('✅ Found recently pushed item (can be reset):');
        console.log(`   ID: ${pushedItem.id}`);
        console.log(`   Title: ${pushedItem.title}`);
        console.log(`   Source: ${pushedItem.source.name}`);
        console.log(`   PushedAt: ${pushedItem.pushedAt}`);
        
        console.log(`\n👉 ACTION REQUIRED: Reset this item to test push.`);
        console.log(`   Command: npx tsx -e "import prisma from './lib/prisma'; prisma.item.update({where:{id:'${pushedItem.id}'},data:{pushedAt:null}}).then(()=>console.log('Reset done'))"`);
    } else {
        console.log('❌ No items found at all in last 7 days.');
    }
  }
}

findCandidate()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
