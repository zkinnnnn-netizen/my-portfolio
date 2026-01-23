import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { Crawler } from '../lib/crawler';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

async function main() {
  const sourceId = process.argv[2];
  if (!sourceId) {
    console.error('用法: ts-node scripts/debug_tsinghua_list.ts <sourceId>');
    return;
  }

  const source: any = await prisma.source.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    console.error(`未找到 Source: ${sourceId}`);
    return;
  }

  const config = source.crawlConfig ? JSON.parse(source.crawlConfig) : {};
  const listUrl =
    config.listUrls && config.listUrls.length > 0 ? config.listUrls[0] : source.url;
  const listUrlObj = new URL(listUrl);
  const listUrlNormalized = listUrlObj.origin + listUrlObj.pathname;

  const crawler = new Crawler();

  console.log(`Fetching list page: ${listUrl}`);
  const listRes = await crawler.fetch(listUrl, null, null);

  if (!listRes.content) {
    console.error('列表页抓取失败');
    return;
  }

  const $ = cheerio.load(listRes.content);
  const regex = config.detailPattern ? new RegExp(config.detailPattern) : null;

  type Row = {
    index: number;
    text: string;
    rawHref: string;
    url: string;
    match: boolean | null;
    samePage: boolean;
    filterHint: string;
  };

  const rows: Row[] = [];
  const seen = new Set<string>();

  $('a').each((_, el) => {
    if (rows.length >= 200) return false as any;
    const rawHref = $(el).attr('href') || '';
    if (!rawHref) return;
    if (rawHref.startsWith('javascript:')) return;
    if (rawHref.startsWith('#')) return;
    if (rawHref.startsWith('mailto:')) return;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(rawHref, listUrl).href;
    } catch {
      return;
    }

    try {
      const urlObj = new URL(absoluteUrl);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p =>
        urlObj.searchParams.delete(p),
      );
      const cleanUrl = urlObj.href;
      if (seen.has(cleanUrl)) return;
      seen.add(cleanUrl);

      const normalized = urlObj.origin + urlObj.pathname;
      const samePage = normalized === listUrlNormalized;

      const text = $(el).text().trim().replace(/\s+/g, ' ');
      const match = regex ? regex.test(cleanUrl) : null;

      let filterHint = '通过';
      if (samePage) {
        filterHint = '同页(listUrl)——应被 LIST_PAGE_NOT_DETAIL 过滤';
      }

      rows.push({
        index: rows.length + 1,
        text: text || '(无文本)',
        rawHref,
        url: cleanUrl,
        match,
        samePage,
        filterHint,
      });
    } catch {
    }
  });

  console.log(`Source: ${source.name}`);
  console.log(`detailPattern: ${config.detailPattern || '(未配置)'}`);
  console.log(`共输出 ${rows.length} 条链接 (仅显示前10条):`);

  for (const row of rows.slice(0, 10)) {
    console.log('------------------------------');
    console.log(`[#${row.index}] 文本: ${row.text}`);
    console.log(`raw href: ${row.rawHref}`);
    console.log(`absolute url: ${row.url}`);
    let flag: string;
    if (regex) {
      flag = row.match ? '命中 detailPattern' : '未命中 detailPattern';
    } else {
      flag = '未配置 detailPattern';
    }
    console.log(`pattern: ${flag}`);
    console.log(
      `same_page: ${row.samePage ? '是(同页)' : '否'}; filter: ${row.filterHint}`,
    );
  }

  // New section: Hit detailPattern links
  if (regex) {
    const hitRows = rows.filter(row => row.match);
    const matchCount = hitRows.length;
    console.log('\n==============================');
    console.log(`命中 detailPattern 的链接前10条 (总数: ${matchCount}):`);
    
    hitRows.slice(0, 10).forEach(row => {
      console.log('------------------------------');
      console.log(`[#${row.index}] 文本: ${row.text}`);
      console.log(`raw href: ${row.rawHref}`);
      console.log(`absolute url: ${row.url}`);
      console.log(`命中/未命中: 命中`);
      console.log(`filter原因: ${row.filterHint}`);
    });
  }
}

main()
  .catch(err => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
