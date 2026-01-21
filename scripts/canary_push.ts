
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { ingestAll } from '../lib/ingest';
import prisma from '../lib/prisma';
import { CANARY_ERRORS } from '../lib/push';

// Canary Configuration
const CANARY_SOURCES = process.env.ONLY_SOURCE ? [process.env.ONLY_SOURCE] : [
  '中央民族大学-通知公告',
  '北京航空航天大学-通知公告',
  '清华大学-通知公告',
  '武汉大学-招生政策',
  '重庆大学-通知公告',
  '厦门大学-通知公告',
  '天津大学-通知公告',
  '武汉大学-招生动态',
  '北京理工大学-通知公告',
  '湖南大学-通知公告'
];

async function main() {
  console.log('=============================================');
  console.log('🚀 Starting Canary Push (Gray Release)');
  console.log('=============================================');

  // --- Step 1 & 3: Gatekeeper & Env Check ---

  // 1.1 Variable Fallback (Backward Compatibility)
  if (!process.env.WECOM_WEBHOOK_CANARY && process.env.WEWORK_WEBHOOK_URL) {
    console.warn('⚠️ WARNING: WECOM_WEBHOOK_CANARY not found, falling back to WEWORK_WEBHOOK_URL.');
    console.warn('   Please rename WEWORK_WEBHOOK_URL to WECOM_WEBHOOK_CANARY in .env or secrets.');
    process.env.WECOM_WEBHOOK_CANARY = process.env.WEWORK_WEBHOOK_URL;
  }

  // 1.2 Strict Validation (Gatekeeper)
  const validationErrors: string[] = [];
  
  if (process.env.CANARY_ENABLED !== 'true') {
    validationErrors.push('CANARY_ENABLED !== "true"');
  }
  
  // Enforce PUSH_MODE='canary' (override if needed, but better to check)
  if (process.env.PUSH_MODE !== 'canary') {
    console.log('ℹ️ Auto-setting PUSH_MODE="canary"');
    process.env.PUSH_MODE = 'canary';
  }

  const webhook = process.env.WECOM_WEBHOOK_CANARY;
  if (!webhook || !webhook.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
    validationErrors.push(`Invalid WECOM_WEBHOOK_CANARY (length=${webhook ? webhook.length : 0})`);
  }

  if (validationErrors.length > 0) {
    console.error('🛑 GATEKEEPER BLOCKED EXECUTION:');
    validationErrors.forEach(e => console.error(`   - ${e}`));
    
    console.error('\nEnvironment Status:');
    console.error(`   CANARY_ENABLED: ${process.env.CANARY_ENABLED} (Source: .env/Secrets)`);
    console.error(`   PUSH_MODE: ${process.env.PUSH_MODE}`);
    console.error(`   WECOM_WEBHOOK_CANARY: ${webhook ? 'Set (Hidden)' : 'MISSING'}`);
    
    process.exit(1);
  }

  // --- Step 2: Configuration & Limits ---
  process.env.MAX_PUSH_PER_RUN = process.env.MAX_PUSH_PER_RUN || '10';      
  process.env.PUSH_PER_TASK_MAX = process.env.PUSH_PER_TASK_MAX || '2';

  console.log(`Configurations:`);
  console.log(`- Mode: ${process.env.PUSH_MODE}`);
  console.log(`- Max Push Total: ${process.env.MAX_PUSH_PER_RUN}`);
  console.log(`- Max Push Per Source: ${process.env.PUSH_PER_TASK_MAX}`);
  console.log(`- Sources: ${CANARY_SOURCES.length}`);

  // --- Step 4: Execution ---
  
  for (const sourceName of CANARY_SOURCES) {
    console.log(`\n---------------------------------------------`);
    console.log(`Processing: ${sourceName}`);
    
    const start = Date.now();
    try {
        await ingestAll({ 
            dryRun: false, 
            sourceName: sourceName 
        });

        // Fetch stats
        const source = await prisma.source.findFirst({
            where: { name: sourceName }
        });
        
        if (source && source.lastRunStats) {
            const stats = typeof source.lastRunStats === 'string' 
                ? JSON.parse(source.lastRunStats) 
                : source.lastRunStats;
            console.log(`[Stats] Fetched: ${stats.fetched}, Upserted: ${stats.upserted}, Pushed: ${stats.pushed}, SkippedByLimit: ${stats.skippedByLimit}, Errors: ${stats.errors}`);
        }

    } catch (e) {
        console.error(`Error processing ${sourceName}:`, e);
    }
    
    console.log(`Finished ${sourceName} in ${Date.now() - start}ms`);
  }

  console.log(`\n=============================================`);
  console.log('🎉 Canary Push Completed');
  console.log('=============================================');

  if (CANARY_ERRORS.length > 0) {
      console.error(`\n\x1b[31m[CRITICAL] Found ${CANARY_ERRORS.length} push errors!\x1b[0m`);
      console.error('IMMEDIATE ACTION: Run `export CANARY_ENABLED="false"` to stop.');
      console.error('Error Details:');
      CANARY_ERRORS.forEach((e, idx) => {
          console.error(` ${idx+1}. Code=${e.code} Msg=${e.msg}`);
          console.error(`    Advice: ${e.advice}`);
      });
      process.exit(1);
  } else {
      console.log('✅ No push errors detected.');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
