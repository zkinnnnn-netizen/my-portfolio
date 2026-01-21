
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import prisma from '../lib/prisma';
import { Crawler } from '../lib/crawler';
import * as cheerio from 'cheerio';

async function main() {
  const sourceName = '中央民族大学-通知公告';
  const source = await prisma.source.findFirst({
    where: { name: sourceName }
  });

  if (!source) {
    console.error('Source not found');
    process.exit(1);
  }

  let crawlConfig = source.crawlConfig as any;
  if (typeof crawlConfig === 'string') {
    try {
        crawlConfig = JSON.parse(crawlConfig);
    } catch (e) {
        console.error('Failed to parse crawlConfig JSON', e);
        process.exit(1);
    }
  }

  if (!crawlConfig || !crawlConfig.listUrls || crawlConfig.listUrls.length === 0) {
    console.error('No listUrls in crawlConfig');
    process.exit(1);
  }

  const listUrl = crawlConfig.listUrls[0];
  console.log(`Fetching list URL: ${listUrl}`);

  const crawler = new Crawler();
  const fetchResult = await crawler.fetch(listUrl, crawlConfig.transport || 'undici');
  const html = fetchResult.content || '';

  const $ = cheerio.load(html);
  
  // Try to find links
  let links: {text: string, href: string}[] = [];
  
  // Use listSelectors if available, otherwise just grab all a tags
  if (crawlConfig.listSelectors && crawlConfig.listSelectors.item) {
      console.log(`Using listSelectors.item: ${crawlConfig.listSelectors.item}`);
      $(crawlConfig.listSelectors.item).each((i, el) => {
          const $a = $(el).find('a');
          if ($a.length > 0) {
            links.push({
                text: $a.text().trim(),
                href: $a.attr('href') || '',
                // @ts-ignore
                context: `Selector matched item`
            });
          }
      });
  } else {
      console.log('No listSelectors.item, grabbing all <a> tags');
      $('a').each((i, el) => {
          const parent = $(el).parent();
          const parentTag = parent.prop('tagName');
          const parentClass = parent.attr('class') || '';
          
          links.push({
              text: $(el).text().trim(),
              href: $(el).attr('href') || '',
              // @ts-ignore
              context: `<${parentTag} class="${parentClass}">`
          });
      });
  }

  console.log(`Found ${links.length} links. Showing 0-${Math.min(links.length, 30)}:`);
  
  const problematicKeywords = ['联系招办', '联系方式', '招办电话', '联系我们'];

  links.slice(0, 30).forEach((link: any, idx) => {
      let logMsg = `[${idx + 41}] Text: "${link.text}"  Href: "${link.href}"  Parent: ${link.context}`;
      
      const isProblematic = problematicKeywords.some(kw => link.text.includes(kw));
      if (isProblematic) {
          console.log(`\x1b[31m${logMsg}  <-- PROBLEMATIC\x1b[0m`);
      } else {
          console.log(logMsg);
      }
  });

}

main().catch(console.error).finally(() => prisma.$disconnect());
