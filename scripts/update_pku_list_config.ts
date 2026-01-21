import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const source: any = await prisma.source.findFirst({
    where: {
      name: '通知公告-北京大学本科招生网',
    },
  });

  if (!source) {
    console.error('未找到 Source: 通知公告-北京大学本科招生网');
    return;
  }

  const baseConfig = source.crawlConfig ? JSON.parse(source.crawlConfig) : {};

  const crawlConfig = {
    ...baseConfig,
    listUrls: ['https://www.gotopku.cn/tzgg/index.htm'],
    detailPattern: 'tzgg/[a-f0-9]{32}\\.htm',
    selectors: {
      ...(baseConfig.selectors || {}),
      title: '.article-head .t',
      date: '.article-head .info',
      content: '#articleDiv',
      attachments: '#articleDiv a',
    },
    listSelectors: {
      item: '.list .item',
      link: 'a',
      title: '.t1',
      date: '.t3',
    },
  };

  await (prisma as any).source.update({
    where: { id: source.id },
    data: {
      crawlConfig: JSON.stringify(crawlConfig),
    },
  });

  console.log('PKU crawlConfig with listSelectors updated.');
}

main()
  .catch(err => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
