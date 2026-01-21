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

  console.log('Before update:');
  console.log(
    JSON.stringify(
      {
        id: source.id,
        url: source.url,
        type: source.type,
        isActive: source.isActive,
        fetchIntervalMinutes: source.fetchIntervalMinutes,
        crawlConfig: source.crawlConfig,
        lastError: source.lastError,
        lastRunStats: source.lastRunStats,
      },
      null,
      2,
    ),
  );

  const rawConfig = source.crawlConfig || '{}';
  let config: any;
  try {
    config = JSON.parse(rawConfig);
  } catch (e) {
    console.error('Failed to parse crawlConfig JSON:', e);
    return;
  }

  config.headers = {
    Referer: 'https://zsb.nankai.edu.cn/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };

  await prisma.source.update({
    where: { id: source.id },
    data: {
      crawlConfig: JSON.stringify(config),
    },
  });

  const updated = await prisma.source.findUnique({ where: { id: source.id } });

  console.log('\nAfter update:');
  console.log(
    JSON.stringify(
      {
        id: updated?.id,
        url: updated?.url,
        type: updated?.type,
        isActive: updated?.isActive,
        fetchIntervalMinutes: updated?.fetchIntervalMinutes,
        crawlConfig: updated?.crawlConfig,
        lastError: updated?.lastError,
        lastRunStats: updated?.lastRunStats,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

