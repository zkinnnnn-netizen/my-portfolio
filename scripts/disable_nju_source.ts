import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sourceName = '南京大学-通知公告';
  const source = await prisma.source.findFirst({
    where: { name: sourceName },
  });

  if (!source) {
    console.error(`Source not found: ${sourceName}`);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  // listUrl we tried: https://bkzs.nju.edu.cn/static/front/nju/basic/html_cms/frontList.html?id=c8673b83bc704353aff9f917cc1e16b2
  const currentUrl = source.url;

  const lastErrorMessage = `DynamicSite:LIST_JS_RENDER status=FETCHED_0 url=${currentUrl} at ${nowIso} (no static anchors; requires JS rendering or alternative official feed)`;

  console.log('=== Source BEFORE update ===');
  console.log(JSON.stringify(source, null, 2));

  const updated = await prisma.source.update({
    where: { id: source.id },
    data: {
      isActive: false,
      fetchIntervalMinutes: 1440,
      lastError: lastErrorMessage,
    },
  });

  console.log('=== Source AFTER update ===');
  console.log(JSON.stringify(updated, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
