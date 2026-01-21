
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

// Minimal Ping Script for WeCom Canary
// No database dependency, no side effects.

async function ping() {
  // 1. Fallback Logic
  if (!process.env.WECOM_WEBHOOK_CANARY && process.env.WEWORK_WEBHOOK_URL) {
    console.warn('⚠️ WARNING: WECOM_WEBHOOK_CANARY not found, falling back to WEWORK_WEBHOOK_URL.');
    process.env.WECOM_WEBHOOK_CANARY = process.env.WEWORK_WEBHOOK_URL;
  }

  const isCanary = process.env.PUSH_MODE === 'canary';
  const isEnabled = process.env.CANARY_ENABLED === 'true';
  const webhook = process.env.WECOM_WEBHOOK_CANARY;

  console.log('--- Canary Ping Config ---');
  console.log(`PUSH_MODE: ${process.env.PUSH_MODE}`);
  console.log(`CANARY_ENABLED: ${process.env.CANARY_ENABLED}`);
  console.log(`WEBHOOK: ${webhook ? webhook.replace(/key=.*/, 'key=***') : 'MISSING'}`);
  console.log('--------------------------');

  if (!isCanary || !isEnabled) {
    console.error('🛑 Ping requires PUSH_MODE=canary and CANARY_ENABLED=true');
    process.exit(1);
  }

  if (!webhook || !webhook.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
    console.error('🛑 Invalid or missing WECOM_WEBHOOK_CANARY');
    process.exit(1);
  }

  const payload = {
    msgtype: 'markdown',
    markdown: {
      content: `### 🐤 Canary Ping\n\n- Time: ${new Date().toISOString()}\n- Host: ${process.env.HOSTNAME || 'unknown'}\n\n*If you see this, webhook is working.*`
    }
  };

  console.log('Sending ping...');
  try {
    const start = Date.now();
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const ms = Date.now() - start;
    const text = await res.text();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Response Body: ${text}`);
    console.log(`Latency: ${ms}ms`);

    if (res.ok) {
        try {
            const body = JSON.parse(text);
            if (body.errcode === 0) {
                console.log('✅ Ping Success (errcode=0)');
                process.exit(0);
            } else {
                console.error(`❌ Ping Failed (Logic): errcode=${body.errcode} errmsg=${body.errmsg}`);
                process.exit(1);
            }
        } catch (e) {
            console.error('❌ Failed to parse response JSON');
            process.exit(1);
        }
    } else {
        console.error(`❌ Ping Failed (HTTP ${res.status})`);
        process.exit(1);
    }

  } catch (e) {
    console.error('❌ Network Error:', e);
    process.exit(1);
  }
}

ping();
