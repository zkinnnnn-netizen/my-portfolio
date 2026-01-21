
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { buildWeComMarkdown } from '../lib/push';

// 1. Load env
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function main() {
  console.log('Starting regression check for recent pushed items...');

  // 2. Fetch last 50 pushed items
  const items = await prisma.item.findMany({
    where: {
      pushedAt: {
        not: null,
      },
    },
    include: {
        source: true,
    },
    orderBy: {
      pushedAt: 'desc',
    },
    take: 50,
  });

  console.log(`Found ${items.length} pushed items.`);

  let failCount = 0;
  const failures: Array<{ title: string; expected: string; reason: string; id: any }> = [];

  // 3. Check each item
  for (const item of items) {
    const expected = (item.canonicalUrl || item.url || '').trim();
    
    // Basic HTTP check
    if (!expected || !expected.startsWith('http')) {
      failCount++;
      failures.push({
        id: item.id,
        title: item.title,
        expected,
        reason: 'Invalid URL format'
      });
      continue;
    }

    // Generate markdown for verification
    let digest: any = {};
    try {
        digest = JSON.parse(item.digest || '{}');
    } catch(e) {
        // ignore
    }
    
    // Mock data for buildWeComMarkdown if digest is incomplete
    // Ideally digest should have everything
    const aiResult = {
        title: item.title,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        publish_date: item.publishedAt ? item.publishedAt.toISOString().split('T')[0] : '',
        ...digest
    };
    
    const markdown = buildWeComMarkdown(aiResult);
    
    // 2.1 Link Extraction & Verification
    const linkMatch = markdown.match(/查看原文\]\((https?:\/\/[^)]+)\)/);
    if (!linkMatch) {
        failCount++;
        failures.push({
            id: item.id,
            title: item.title,
            expected,
            reason: 'Link not found in markdown'
        });
        continue;
    }
    
    const extractedLink = linkMatch[1].trim();
    if (extractedLink !== expected) {
        failCount++;
        failures.push({
            id: item.id,
            title: item.title,
            expected,
            reason: `Link mismatch: extracted=${extractedLink} expected=${expected}`
        });
        continue;
    }
    
    // Check against listUrl if available
    if (item.source && item.source.crawlConfig) {
        try {
            const config = JSON.parse(item.source.crawlConfig);
            if (config.listUrls && config.listUrls.length > 0) {
                const listUrl = config.listUrls[0].trim().replace(/\/$/, '');
                const cleanExtracted = extractedLink.replace(/\/$/, '');
                if (cleanExtracted === listUrl) {
                     failCount++;
                     failures.push({
                        id: item.id,
                        title: item.title,
                        expected,
                        reason: `Link points to List URL: ${extractedLink}`
                    });
                    continue;
                }
            }
        } catch (e) {
            // ignore config parse error
        }
    }

    // 2.2 Length Check
    const bytes = Buffer.byteLength(markdown, 'utf8');
    if (bytes > 3500) {
        failCount++;
        failures.push({
            id: item.id,
            title: item.title,
            expected,
            reason: `Markdown too long: ${bytes} bytes > 3500`
        });
        console.log(`[FAIL-LENGTH] ${item.title} (${bytes} bytes)`);
        console.log(markdown.substring(0, 300));
        continue;
    }

    console.log(`[OK] [${item.id}] ${item.title.substring(0, 30)}... (Link OK, ${bytes} bytes)`);
  }

  // 4. Summary
  console.log('\n========================================');
  console.log(`Total Checked: ${items.length}`);
  console.log(`FAIL Count:    ${failCount}`);
  console.log('========================================');

  if (failCount > 0) {
    console.log('\nTop 5 Failures:');
    failures.slice(0, 5).forEach((f, idx) => {
      console.log(`${idx + 1}. [ID:${f.id}] ${f.title}`);
      console.log(`   Expected: "${f.expected}"`);
      console.log(`   Reason:   ${f.reason}`);
    });
    process.exit(1);
  } else {
    console.log('\nSUCCESS: All checked items have valid HTTP URLs and safe length.');
    process.exit(0);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
