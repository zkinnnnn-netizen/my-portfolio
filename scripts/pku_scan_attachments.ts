import { PrismaClient } from '@prisma/client';
import { Crawler } from '../lib/crawler';
import { extractInformation } from '../lib/ai';
import { buildWeComMarkdown } from '../lib/push';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

type Attachment = { name: string; url: string };

function filterFileAttachments(atts: Attachment[]): Attachment[] {
  const exts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar'];
  const seen = new Set<string>();
  const result: Attachment[] = [];

  for (const att of atts || []) {
    if (!att || !att.url) continue;
    const rawUrl = att.url;
    const urlNoFragment = rawUrl.split('#')[0].split('?')[0];
    const lower = urlNoFragment.toLowerCase();
    const matched = exts.some(ext => lower.endsWith('.' + ext));
    if (!matched) continue;

    const key = `${att.name || ''}||${urlNoFragment}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      name: att.name || urlNoFragment.split('/').pop() || 'Attachment',
      url: urlNoFragment,
    });
  }

  return result;
}

async function collectDetailItems(
  startUrl: string,
  maxCount: number
): Promise<{ url: string; title?: string; listDate?: Date | null }[]> {
  const crawler = new Crawler();
  const rows: any[] = await prisma.$queryRaw`SELECT "crawlConfig" FROM "Source" WHERE name = '通知公告-北京大学本科招生网' LIMIT 1`;
  const rawConfig = rows[0]?.crawlConfig as string | null | undefined;
  const config = rawConfig ? JSON.parse(rawConfig) : {};

  const collected: { url: string; title?: string; listDate?: Date | null }[] = [];
  const seenDetail = new Set<string>();
  const visitedList = new Set<string>();
  const queue: string[] = [startUrl];

  while (collected.length < maxCount && queue.length > 0) {
    const listUrl = queue.shift()!;
    if (visitedList.has(listUrl)) continue;
    visitedList.add(listUrl);

    console.log('Fetching list page:', listUrl);
    const res = await crawler.fetch(listUrl, null, null);
    if (!res.content) continue;

    const listItems = crawler.parseList(res.content, listUrl, config);

    for (const item of listItems) {
      if (!item.url) continue;
      if (seenDetail.has(item.url)) continue;
      seenDetail.add(item.url);

      collected.push({
        url: item.url,
        title: item.title,
        listDate: item.date ?? null,
      });

      if (collected.length >= maxCount) break;
    }

    if (collected.length >= maxCount) break;

    const $ = cheerio.load(res.content);
    const nextLink = $('a')
      .filter((_, el) => $(el).text().trim() === '下一页')
      .first();
    const href = nextLink.attr('href');
    if (href) {
      try {
        const nextUrl = new URL(href, listUrl).href;
        if (!visitedList.has(nextUrl)) {
          queue.push(nextUrl);
        }
      } catch {
      }
    }
  }

  return collected;
}

async function main() {
  const startUrl = 'https://www.gotopku.cn/tzgg/index.htm';
  const maxDetails = 200;

  const detailItems = await collectDetailItems(startUrl, maxDetails);
  console.log(`Collected ${detailItems.length} detail URLs (target ${maxDetails}).`);

  const crawler = new Crawler();

  const rows: any[] = await prisma.$queryRaw`SELECT "name", "crawlConfig" FROM "Source" WHERE name = '通知公告-北京大学本科招生网' LIMIT 1`;
  const sourceRow = rows[0] as { name: string; crawlConfig?: string } | undefined;
  const sourceName = sourceRow?.name || '通知公告-北京大学本科招生网';
  const config = sourceRow?.crawlConfig ? JSON.parse(sourceRow.crawlConfig) : {};

  const hits: {
    item: { url: string; title?: string; listDate?: Date | null };
    title: string;
    publishDate: string | null;
    attachments: Attachment[];
    attachmentsSection: string;
  }[] = [];

  for (const item of detailItems) {
    if (hits.length >= 3) break;

    console.log('Fetching detail:', item.url);
    const res = await crawler.fetch(item.url, null, null);
    if (!res.content) continue;

    const parsed = crawler.parseDetail(res.content, item.url, config.selectors);
    
    // First, filter static attachments by extension
    let validAttachments = filterFileAttachments(parsed.attachments || []);
    
    // If fewer than 3 attachments (or always, if we want robust), try enrichment
    // Here we'll do it if we found nothing, OR if user wants to be thorough. 
    // Let's do it always for this scan to prove it works.
    console.log(`Static analysis found ${validAttachments.length} attachments. Running enrichment...`);
    
    const enriched = await crawler.enrichAttachments(res.content, item.url, validAttachments);
    
    // De-duplicate enriched result (enrichAttachments already does some, but let's be safe)
    // Also, filterFileAttachments is strict on extension, but enrichAttachments returns confirmed files (via HEAD) that might lack extension.
    // So we CANNOT use filterFileAttachments on the result of enrichAttachments directly if we want to keep non-extension files.
    // We trust enrichAttachments result.
    
    validAttachments = enriched;

    const attachmentsCount = validAttachments.length;
    console.log(`Final attachments count: ${attachmentsCount}`);

    if (attachmentsCount === 0) {
      continue;
    }

    const body = parsed.content || '';
    const aiResult = await extractInformation(
      body,
      item.url,
      sourceName,
      false,
      validAttachments // Pass trusted attachments
    );

    if (!aiResult.publish_date) {
      if (parsed.date) {
        aiResult.publish_date = parsed.date.toISOString().split('T')[0];
      } else if (item.listDate) {
        aiResult.publish_date = item.listDate.toISOString().split('T')[0];
      }
    }

    if (!aiResult.title) {
      aiResult.title = parsed.title || item.title || null;
    }

    const rendered = buildWeComMarkdown(aiResult);

    const lines = rendered.split('\n');
    const attLines: string[] = [];
    let inAtt = false;
    for (const line of lines) {
      if (line.includes('**附件**：')) {
        inAtt = true;
        attLines.push(line);
        continue;
      }
      if (inAtt) {
        if (line.startsWith('- ')) {
          attLines.push(line);
        } else {
          break;
        }
      }
    }

    const title =
      aiResult.title || parsed.title || item.title || 'No Title';
    const dateObj = parsed.date || item.listDate || null;
    const publishDate = aiResult.publish_date || (dateObj
      ? dateObj.toISOString().split('T')[0]
      : null);

    hits.push({
      item,
      title,
      publishDate,
      attachments: validAttachments,
      attachmentsSection: attLines.join('\n'),
    });
  }

  if (hits.length === 0) {
    console.log('No file-type attachments found in first', detailItems.length, 'items.');
    console.log(
      'Possible reason: attachments are not exposed as direct file links (may require buttons, second-level pages, or JS).'
    );
  } else {
    hits.forEach((hit, idx) => {
      console.log('==============================');
      console.log(`Hit #${idx + 1}`);
      console.log('title:', hit.title);
      console.log('detail_url:', hit.item.url);
      console.log('publish_date:', hit.publishDate);
      console.log('attachments_count:', hit.attachments.length);
      console.log(
        'attachments_sample:',
        hit.attachments.slice(0, 3).map(a => ({ name: a.name, url: a.url }))
      );
      console.log('attachments_section:');
      console.log(hit.attachmentsSection || '(no attachments section in rendered text)');
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
