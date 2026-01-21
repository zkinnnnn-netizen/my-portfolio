import { PrismaClient } from '@prisma/client';
import { Crawler } from '../lib/crawler';
import * as cheerio from 'cheerio';
import { extractInformation } from '../lib/ai';
import { buildWeComMarkdown } from '../lib/push';

const prisma = new PrismaClient();

async function main() {
  const source: any = await prisma.source.findUnique({
    where: {
      id: '8ac71185-e807-44a3-99e4-f0fcd47304ea',
    },
  });

  if (!source) {
    console.error('未找到 Source: 8ac71185-e807-44a3-99e4-f0fcd47304ea');
    return;
  }

  const config = source.crawlConfig ? JSON.parse(source.crawlConfig) : {};
  const listUrl =
    config.listUrls && config.listUrls.length > 0 ? config.listUrls[0] : source.url;

  const crawler = new Crawler();

  console.log(`Fetching list page: ${listUrl}`);
  const listRes = await crawler.fetch(listUrl, null, null);

  if (!listRes.content) {
    console.error('列表页抓取失败');
    return;
  }

  const listSelectors = config.listSelectors || {};
  const $ = cheerio.load(listRes.content);
  const itemSel = listSelectors.item || '.list .item';
  const linkSel = listSelectors.link || 'a';
  const titleSel = listSelectors.title;
  const dateSel = listSelectors.date;
  const regex = config.detailPattern ? new RegExp(config.detailPattern) : null;

  type ListItem = {
    url: string;
    title?: string;
    listDate?: Date | null;
  };

  const candidates: ListItem[] = [];

  $(itemSel)
    .slice(0, 20)
    .each((_, el) => {
      const linkEl = $(el).find(linkSel).first();
      const href = linkEl.attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, listUrl).href;
        const urlObj = new URL(absoluteUrl);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p =>
          urlObj.searchParams.delete(p),
        );
        const cleanUrl = urlObj.href;

        if (regex && !regex.test(cleanUrl)) {
          return;
        }

        let title: string | undefined;
        if (titleSel) {
          title = $(el).find(titleSel).first().text().trim();
        } else {
          title = linkEl.text().trim();
        }

        let listDate: Date | null | undefined = undefined;
        if (dateSel) {
          const dateText = $(el).find(dateSel).first().text().trim();
          if (dateText) {
            const m = dateText.match(/(\d{4}\.\d{2}\.\d{2})/);
            const dateStr = m ? m[1] : dateText;
            listDate = parseListDate(dateStr);
          }
        }

        candidates.push({
          url: cleanUrl,
          title,
          listDate: listDate ?? null,
        });
      } catch {
      }
    });

  console.log(`Found ${candidates.length} list items (after filter). Running detail dry-run...`);

  let printed = 0;
  for (const item of candidates) {
    if (printed >= 5) break;

    const exists = await prisma.item.count({
      where: {
        sourceId: source.id,
        canonicalUrl: item.url,
      },
    });
    if (exists > 0) {
      continue;
    }

    const detailRes = await crawler.fetch(item.url, null, null);
    if (!detailRes.content) continue;

    const parsed = crawler.parseDetail(detailRes.content, item.url, config.selectors);
    const body = parsed.content || '';
    if (body.length < 50) {
      console.log(`Skipping ${item.url}: Content too short.`);
      continue;
    }

    const debug = printed === 0;
    const aiResult = await extractInformation(body, item.url, source.name, debug);

    if (!aiResult.publish_date) {
      if (item.listDate) {
        aiResult.publish_date = item.listDate.toISOString().split('T')[0];
      } else if (parsed.date) {
        aiResult.publish_date = parsed.date.toISOString().split('T')[0];
      }
    }

    if (!aiResult.title) {
      if (item.title) {
        aiResult.title = item.title;
      } else if (parsed.title) {
        aiResult.title = parsed.title;
      }
    }

    const finalTitle = aiResult.title || parsed.title || item.title || 'No Title';
    const publishDate = parsed.date || item.listDate || null;
    const rendered = buildWeComMarkdown(aiResult);

    console.log('------------------------------');
    console.log('title:', finalTitle);
    console.log('detail_url:', item.url);
    console.log(
      'publish_date:',
      publishDate ? publishDate.toISOString().split('T')[0] : 'null',
    );
    console.log('body_length:', body.length);
    console.log('is_relevant:', aiResult.is_relevant);
    console.log('confidence:', aiResult.confidence);
    const atts = aiResult.attachments || [];
    console.log('attachments_count:', atts.length);
    console.log(
      'attachments_sample:',
      atts.slice(0, 3).map(a => ({ name: a.name, url: a.url })),
    );
    console.log('rendered_text:\n', rendered);

    printed += 1;
  }

  if (printed === 0) {
    console.log('没有可打印的（全是已存在或抓取失败）');
  }
}

function parseListDate(text: string): Date | null {
  const m = text.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return new Date(year, month - 1, day);
}

main()
  .catch(err => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
