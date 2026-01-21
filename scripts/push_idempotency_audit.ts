
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import prisma from '../lib/prisma';

async function checkIdempotency() {
  console.log('🔍 Checking Push Idempotency (Last 48 Hours)...');
  
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  
  // Find items marked as pushed recently
  const pushedItems = await prisma.item.findMany({
    where: {
      pushedAt: { gte: since }
    },
    select: { id: true, title: true, pushedAt: true }
  });

  console.log(`Found ${pushedItems.length} items marked as pushed.`);

  let violations = 0;

  for (const item of pushedItems) {
    // Check for successful audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        itemId: item.id,
        action: 'PUSH_WECOM',
        result: 'PUSHED' // Or whatever success state is defined
      }
    });

    if (!audit) {
        // Double check if there is ANY audit log
        const anyAudit = await prisma.auditLog.findFirst({
            where: { itemId: item.id, action: 'PUSH_WECOM' }
        });
        
        console.error(`\n🚨 VIOLATION: Item ${item.id} "${item.title}"`);
        console.error(`   Marked PushedAt: ${item.pushedAt}`);
        console.error(`   Audit Log: ${anyAudit ? `Found but result=${anyAudit.result}` : 'MISSING'}`);
        violations++;
    }
  }

  if (violations > 0) {
      console.error(`\n❌ Found ${violations} items marked as pushed without successful audit log!`);
      console.error('   This implies items are being marked as pushed even when push fails or is skipped.');
      process.exit(1);
  } else {
      console.log('✅ All pushed items have corresponding success audit logs.');
  }
}

checkIdempotency()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
