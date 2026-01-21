
import { loadEnvConfig } from '@next/env';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 1. Load env
loadEnvConfig(process.cwd());

async function main() {
    const CANARY_ENABLED = process.env.CANARY_ENABLED;
    const PUSH_MODE = process.env.PUSH_MODE;

    // Gatekeeper
    if (CANARY_ENABLED !== 'true' || PUSH_MODE !== 'canary') {
        console.log(`[HealthReport] Skip sending: CANARY_ENABLED=${CANARY_ENABLED}, PUSH_MODE=${PUSH_MODE}`);
        return;
    }

    const reportPath = path.join(process.cwd(), 'tmp', 'health_report.md');
    
    // 2. Ensure report exists
    if (!fs.existsSync(reportPath)) {
        console.log('[HealthReport] Report not found, generating...');
        execSync('npx tsx scripts/health_report.ts', { stdio: 'inherit' });
    }


    let markdown = fs.readFileSync(reportPath, 'utf8');

    // 2.5 Clean Table Characters (Prevent Markdown table rendering)
    // Remove: | (ASCII pipe), ┌ └ ─ │ (Box drawing)
    markdown = markdown.replace(/[|┌└─│]/g, '');

    // 3. Truncate if needed
    const MAX_BYTES = 3500;
    const currentBytes = Buffer.byteLength(markdown, 'utf8');
    
    if (currentBytes > MAX_BYTES) {
        console.warn(`[HealthReport] Truncating report: ${currentBytes} -> ${MAX_BYTES} bytes`);
        const footer = '\n\n(内容过长已截断)';
        const footerBytes = Buffer.byteLength(footer, 'utf8');
        const availableBytes = MAX_BYTES - footerBytes;
        const buf = Buffer.from(markdown, 'utf8');
        const slicedBuf = buf.subarray(0, availableBytes);
        markdown = slicedBuf.toString('utf8') + footer;
    }

    // 4. Send to WeCom
    const webhook = process.env.WECOM_WEBHOOK_CANARY;
    if (!webhook) {
        console.error('[HealthReport] Missing WECOM_WEBHOOK_CANARY env var');
        process.exit(1);
    }

    console.log(`[HealthReport] Sending ${Buffer.byteLength(markdown, 'utf8')} bytes to Canary...`);
    
    try {
        const res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgtype: 'markdown',
                markdown: { content: markdown }
            })
        });

        if (!res.ok) {
            console.error(`[HealthReport] HTTP Error: ${res.status} ${res.statusText}`);
            const text = await res.text();
            console.error(text);
            process.exit(1);
        }

        const body = await res.json();
        console.log(`HTTP status: ${res.status}`);
        console.log('Response body:', body);

        if (body.errcode === 0) {
            console.log('✅ Health Report Sent Successfully');
        } else {
            console.error(`❌ Send Failed: errcode=${body.errcode}, errmsg=${body.errmsg}`);
            process.exit(1);
        }

    } catch (e) {
        console.error('[HealthReport] Network Error:', e);
        process.exit(1);
    }
}

main().catch(console.error);
