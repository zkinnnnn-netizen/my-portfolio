import prisma from '../lib/prisma';

const TARGET_NAMES = [
  '南京大学-通知公告',
  '南开大学-通知公告',
  '西北农林科技大学-招生指南',
];

async function main() {
  const sources = await prisma.source.findMany({
    where: { name: { in: TARGET_NAMES } },
  });

  const result: any[] = [];

  for (const source of sources) {
    const items = await prisma.item.findMany({
      where: { sourceId: source.id },
    });

    const skipCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    for (const item of items) {
      const skipKey = item.skipReason || 'null';
      skipCounts[skipKey] = (skipCounts[skipKey] || 0) + 1;

      const statusKey = item.status || 'UNKNOWN';
      statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
    }

    result.push({
      id: source.id,
      name: source.name,
      skipCounts,
      statusCounts,
    });
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

