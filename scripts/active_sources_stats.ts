import prisma from '../lib/prisma';

async function main() {
  const sources = await prisma.source.findMany({ where: { isActive: true } });
  const output = sources.map(s => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    isActive: s.isActive,
    fetchIntervalMinutes: s.fetchIntervalMinutes,
    lastError: s.lastError,
    lastFetchedAt: s.lastFetchedAt,
    lastRunStats: s.lastRunStats,
    crawlConfig: s.crawlConfig,
  }));
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

