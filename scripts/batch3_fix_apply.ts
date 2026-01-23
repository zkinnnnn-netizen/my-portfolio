
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Applying Fixes ===');

  // 1. 东南大学 (Disable)
  try {
    await prisma.source.updateMany({
      where: { name: '东南大学-通知公告' },
      data: {
        isActive: false,
        lastError: 'Blocked:curl_failed_too at https://seuzsb.seu.edu.cn/13697/list.htm'
      }
    });
    console.log('Disabled 东南大学');
  } catch (e) { console.error('Error updating 东南大学', e); }

  // 2. 四川大学 (Enable Curl)
  const scu = await prisma.source.findFirst({ where: { name: '四川大学-通知公告' } });
  if (scu) {
    const config = JSON.parse(scu.crawlConfig || '{}');
    config.transport = 'curl';
    await prisma.source.update({
      where: { id: scu.id },
      data: {
        crawlConfig: JSON.stringify(config),
        isActive: true,
        fetchIntervalMinutes: 120,
        lastError: null
      }
    });
    console.log('Fixed 四川大学');
  }

  // 3. 吉林大学 (Curl + Timeout)
  const jlu = await prisma.source.findFirst({ where: { name: '吉林大学-通知公告' } });
  if (jlu) {
    const config = JSON.parse(jlu.crawlConfig || '{}');
    config.transport = 'curl';
    config.curlArgs = ['--connect-timeout', '10'];
    // Previous run fetched 46, so selectors are likely fine (auto-detected).
    // Errors were likely timeouts.
    await prisma.source.update({
      where: { id: jlu.id },
      data: {
        crawlConfig: JSON.stringify(config),
        isActive: true,
        fetchIntervalMinutes: 120
      }
    });
    console.log('Fixed 吉林大学');
  }

  // 4. 上海交大 (Curl + Timeout + Pattern)
  const sjtu = await prisma.source.findFirst({ where: { name: '上海交通大学-通知公告' } });
  if (sjtu) {
    const config = JSON.parse(sjtu.crawlConfig || '{}');
    config.transport = 'curl';
    config.curlArgs = ['--connect-timeout', '10'];
    config.detailPattern = 'https://admissions\\.sjtu\\.edu\\.cn/newDetails.*';
    await prisma.source.update({
      where: { id: sjtu.id },
      data: {
        crawlConfig: JSON.stringify(config),
        isActive: true,
        fetchIntervalMinutes: 120
      }
    });
    console.log('Fixed 上海交大');
  }

  // 5. 大连理工 (Disable)
  try {
    await prisma.source.updateMany({
      where: { name: '大连理工大学-通知公告' },
      data: {
        isActive: false,
        lastError: 'DynamicSite:LIST_JS_RENDER'
      }
    });
    console.log('Disabled 大连理工');
  } catch (e) { console.error('Error updating 大连理工', e); }

  // 6. 同济大学 (Disable)
  try {
    await prisma.source.updateMany({
      where: { name: '同济大学-通知公告' },
      data: {
        isActive: false,
        lastError: 'DynamicSite:LIST_JS_RENDER'
      }
    });
    console.log('Disabled 同济大学');
  } catch (e) { console.error('Error updating 同济大学', e); }
  
  // Verification Dry-Run for fixed sources
  const verifySources = ['四川大学-通知公告', '吉林大学-通知公告', '上海交通大学-通知公告'];
  for (const name of verifySources) {
      console.log(`\nVerifying ${name}...`);
      try {
        const { stats } = await ingestAll({ dryRun: true, sourceName: name });
        console.log(`Stats for ${name}:`, stats);
      } catch (e: any) {
        console.error(`Verification failed for ${name}:`, e.message);
      }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
