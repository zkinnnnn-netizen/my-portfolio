
import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';
import { execFileSync } from 'child_process';
import fs from 'fs';

const prisma = new PrismaClient();

const TARGET_SOURCES = [
  '东南大学-通知公告',
  '四川大学-通知公告',
  '吉林大学-通知公告',
  '上海交通大学-通知公告',
  '大连理工大学-通知公告',
  '同济大学-通知公告'
];

async function main() {
  console.log('=== Step A: Diagnosis & Information Gathering ===\n');

  for (const name of TARGET_SOURCES) {
    console.log(`\n>>> Processing Source: ${name} <<<`);
    
    // A1: DB Info
    const source = await prisma.source.findFirst({ where: { name } });
    if (!source) {
      console.log(`Source not found: ${name}`);
      continue;
    }
    
    console.log('[A1] DB Info:');
    console.log(`ID: ${source.id}`);
    console.log(`Name: ${source.name}`);
    console.log(`Active: ${source.isActive}`);
    console.log(`URL: ${source.url}`);
    console.log(`Type: ${source.type}`);
    console.log(`Interval: ${source.fetchIntervalMinutes}`);
    console.log(`LastError: ${source.lastError}`);
    console.log(`LastRunStats: ${JSON.stringify(source.lastRunStats)}`);
    
    let crawlConfig: any = {};
    try {
      crawlConfig = JSON.parse(source.crawlConfig || '{}');
      console.log('CrawlConfig:', JSON.stringify(crawlConfig, null, 2));
    } catch (e) {
      console.log('CrawlConfig: INVALID JSON');
    }

    // A2: Dry-run
    console.log('\n[A2] Single Source Dry-Run:');
    try {
      // Capture logs if possible, or just let it print
      await ingestAll({ dryRun: true, sourceName: name });
    } catch (e: any) {
      console.error('Dry-run threw exception:', e.message);
    }

    // A3: Raw Curl Check
    console.log('\n[A3] Raw Curl Check (List URL):');
    const listUrl = crawlConfig.listUrls?.[0] || source.url;
    if (!listUrl) {
      console.log('No list URL found, skipping curl check.');
      continue;
    }
    
    console.log(`Target URL: ${listUrl}`);
    try {
      const tmpPath = '/tmp/check.html';
      // curl -sS -D - -o /tmp/check.html -L "<LIST_URL>"
      // We use execFileSync
      const output = execFileSync('curl', [
        '-sS',
        '-D', '-', // Headers to stdout
        '-o', tmpPath,
        '-L', // Follow redirects
        '--connect-timeout', '10',
        '--max-time', '20',
        listUrl
      ], { encoding: 'utf-8' });

      // Parse headers from output
      const lines = output.split('\n');
      const statusLine = lines.find(l => l.startsWith('HTTP/'));
      const setCookies = lines.filter(l => l.toLowerCase().startsWith('set-cookie:'));
      
      console.log(`HTTP Status: ${statusLine?.trim() || 'Unknown'}`);
      if (setCookies.length > 0) {
        console.log('Set-Cookie headers found:', setCookies.length);
        setCookies.forEach(c => console.log(`  ${c.trim().substring(0, 100)}...`));
      } else {
        console.log('No Set-Cookie headers.');
      }

      if (fs.existsSync(tmpPath)) {
        const stats = fs.statSync(tmpPath);
        console.log(`Body size: ${stats.size} bytes`);
        
        // Extract hrefs
        const content = fs.readFileSync(tmpPath, 'utf-8');
        // Simple regex to find hrefs, quick and dirty for diagnostics
        const hrefRegex = /href=["'](.*?)["']/g;
        let match;
        const hrefs: string[] = [];
        while ((match = hrefRegex.exec(content)) !== null) {
          if (hrefs.length >= 10) break;
          hrefs.push(match[1]);
        }
        console.log('First 10 hrefs extracted:', hrefs);
        
        // Clean up
        fs.unlinkSync(tmpPath);
      } else {
        console.log('Body file not found.');
      }

    } catch (e: any) {
      console.log('Curl check failed:', e.message);
      if (e.stdout) console.log('Stdout:', e.stdout);
      if (e.stderr) console.log('Stderr:', e.stderr);
    }
    
    console.log('--------------------------------------------------');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
