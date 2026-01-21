import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

async function checkEnv() {
  console.log('--- Env Check ---');
  console.log(`CANARY_ENABLED: ${process.env.CANARY_ENABLED}`);
  console.log(`PUSH_MODE: ${process.env.PUSH_MODE}`);
  console.log(`MAX_PUSH_PER_RUN: ${process.env.MAX_PUSH_PER_RUN}`);
  console.log(`PUSH_PER_TASK_MAX: ${process.env.PUSH_PER_TASK_MAX}`);

  const webhook = process.env.WECOM_WEBHOOK_CANARY;
  if (!webhook) {
    console.error('❌ WECOM_WEBHOOK_CANARY is MISSING');
  } else {
    console.log(`WECOM_WEBHOOK_CANARY Length: ${webhook.length}`);
    const masked = webhook.substring(0, 60) + '***';
    console.log(`WECOM_WEBHOOK_CANARY Prefix: ${masked}`);
    
    if (webhook.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
      console.log('✅ Webhook format OK');
    } else {
      console.error('❌ Webhook format INVALID');
    }
  }
}

checkEnv();
