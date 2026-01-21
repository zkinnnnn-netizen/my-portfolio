import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const sources = [
    {
      name: 'MIT 招生办博客',
      type: 'RSS',
      url: 'https://mitadmissions.org/feed/',
      regionTag: 'US',
      categoryTag: '留学',
      priority: 5,
    },
    {
      name: 'Codeforces 竞赛动态',
      type: 'RSS',
      url: 'https://codeforces.com/rss/recent-actions',
      regionTag: 'Global',
      categoryTag: '竞赛',
      priority: 4,
    },
    {
      name: '教育部政策发布',
      type: 'HTML',
      url: 'http://www.moe.gov.cn/jyb_xwfb/s5147/',
      regionTag: 'CN',
      categoryTag: '政策',
      priority: 5,
    },
    {
      name: '清华大学本科招生网',
      type: 'HTML',
      url: 'https://join-tsinghua.edu.cn/tzgg.htm',
      regionTag: 'CN',
      categoryTag: '升学',
      priority: 5,
    },
    {
      name: 'NOI 信息学奥林匹克',
      type: 'HTML',
      url: 'https://www.noi.cn/xw/xinwen/',
      regionTag: 'CN',
      categoryTag: '竞赛',
      priority: 4,
    },
    {
      name: '兰州大学本科招生网',
      type: 'HTML',
      url: 'https://zsb.lzu.edu.cn/zszc.htm', // Main URL, but we use config
      regionTag: 'CN',
      categoryTag: '升学',
      priority: 5,
      crawlConfig: JSON.stringify({
        listUrls: ['https://zsb.lzu.edu.cn/zszc.htm'],
        detailPattern: 'info/\\d+\\.htm', // Example regex for detail pages
        selectors: {
          title: '.article-title',
          date: '.article-date',
          content: '.article-content'
        }
      })
    }
  ]

  console.log('Start seeding ...')
  
  for (const s of sources) {
    const data: any = {
      name: s.name,
      type: s.type,
      regionTag: s.regionTag,
      categoryTag: s.categoryTag,
      priority: s.priority,
    };
    if ((s as any).crawlConfig) {
        data.crawlConfig = (s as any).crawlConfig;
    }

    const source = await prisma.source.upsert({
      where: { url: s.url },
      update: data,
      create: {
        ...data,
        url: s.url,
      },
    })
    console.log(`Created/Updated source: ${source.name}`)
  }
  console.log('Seeding finished.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
