import prisma from '../lib/prisma';

async function main() {
  const name = '南开大学-通知公告';

  const source = await prisma.source.findFirst({
    where: { name },
  });

  if (!source) {
    console.error(`Source not found: ${name}`);
    return;
  }

  const beforeConfig = source.crawlConfig ? JSON.parse(source.crawlConfig) : null;
  const before = {
    id: source.id,
    name: source.name,
    url: source.url,
    isActive: source.isActive,
    fetchIntervalMinutes: source.fetchIntervalMinutes,
    lastError: source.lastError,
    lastRunStats: source.lastRunStats,
    crawlConfig: beforeConfig,
  };

  console.log('=== Source BEFORE update ===');
  console.log(JSON.stringify(before, null, 2));

  const nowIso = new Date().toISOString();
  const lastErrorMessage =
    `WAFBlocked:NKSOC_JS_CHALLENGE status=412 url=\`https://zsb.nankai.edu.cn/\` ` +
    ` at ${nowIso} (requires JS+cookie clearance)`;

  const updated = await prisma.source.update({
    where: { id: source.id },
    data: {
      isActive: false,
      fetchIntervalMinutes: 1440,
      lastError: lastErrorMessage,
    },
  });

  const afterConfig = updated.crawlConfig ? JSON.parse(updated.crawlConfig) : null;
  const after = {
    id: updated.id,
    name: updated.name,
    url: updated.url,
    isActive: updated.isActive,
    fetchIntervalMinutes: updated.fetchIntervalMinutes,
    lastError: updated.lastError,
    lastRunStats: updated.lastRunStats,
    crawlConfig: afterConfig,
  };

  console.log('=== Source AFTER update ===');
  console.log(JSON.stringify(after, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

