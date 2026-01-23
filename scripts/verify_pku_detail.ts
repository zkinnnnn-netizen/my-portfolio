import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();
const SAMPLE_URL = 'https://www.gotopku.cn/tzgg/178e2332ccce4d9198e8d3d5eebdb656.htm';

async function verify() {
  try {
    const source = await prisma.source.findFirst({
      where: { name: '通知公告-北京大学本科招生网' }
    });

    if (!source) {
      console.error('Source not found');
      return;
    }

    const cfgRaw = (source as any).crawlConfig;
    const config = typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : cfgRaw;
    console.log('Current Config Selectors:', JSON.stringify(config?.selectors, null, 2));

    const contentSelector = config?.selectors?.content;
    if (!contentSelector) {
      console.error('No content selector defined in config!');
      return;
    }

    console.log(`\nFetching ${SAMPLE_URL}...`);
    const res = await fetch(SAMPLE_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    $('nav, footer, header, aside, .nav, .footer, .header, .sidebar, script, style, .related, .comment').remove();

    const inspect = (label: string, selector: string) => {
      const $sel = $(selector);
      const raw = $sel.text();

      console.log(`\n--- ${label} Raw InnerText (${selector}) ---`);
      console.log(`Length: ${raw.length}`);
      console.log(`Preview (first 200): ${raw.substring(0, 200).replace(/\n/g, '\\n')}`);

      const fragmentHtml = $sel.html() || '';
      let cleaned = cheerio.load(fragmentHtml).text();
      cleaned = cleaned.replace(/\s+/g, ' ').trim();

      console.log(`\n--- ${label} Cleaned Body Text ---`);
      console.log(`Length: ${cleaned.length}`);
      console.log(`Preview (first 200): ${cleaned.substring(0, 200)}`);

      return cleaned.length;
    };

    const oldLen = inspect('Old #articleDiv', '#articleDiv');
    const newLen = inspect('Config selector', contentSelector);

    if (newLen > 300) {
      console.log('\nSUCCESS: Config selector body length > 300');
    } else {
      console.log('\nFAILURE: Config selector body length <= 300');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
