
process.loadEnvFile();
import { Crawler } from '../lib/crawler';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { extractInformation } from '../lib/ai';
import { buildWeComMarkdown, pushToWeCom } from '../lib/push';

async function main() {
  const args = process.argv.slice(2);
  const urlArg = args.find(a => !a.startsWith('--'));
  const url = urlArg || 'https://www.gotopku.cn/tzgg/558ce40e3e8148159d16271b06030277.htm';
  const crawler = new Crawler();

  console.log(`Fetching ${url}...`);
  const res = await crawler.fetch(url, null, null);

  if (!res.content) {
    console.error('Fetch failed');
    return;
  }
  
  // DEBUG: Print HTML around "附件" or "名单" to see structure
  const keywordIndex = res.content.indexOf('名单');
  if (keywordIndex !== -1) {
      console.log('HTML Context:', res.content.substring(keywordIndex - 200, keywordIndex + 200));
  } else {
      console.log('Keyword "名单" not found in HTML');
  }

  // Use known working selector for content
  const selectors = {
    content: '.x-layout',
    detailTitle: '.title h2',
    detailDate: '.title p',
    detailContent: '.v_news_content'
  };

  // DEBUG: Cheerio check
  const cheerio = require('cheerio');
  const $ = cheerio.load(res.content);
  const layout = $('.x-layout');
  console.log('DEBUG: Links in .x-layout:');
  layout.find('a').each((i: number, el: any) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      console.log(`Link ${i}: [${text}](${href})`);
  });
  console.log('DEBUG: End of links');

  const parsed = crawler.parseDetail(res.content, url, selectors);
  
  console.log('Parsed Attachments (Crawler):', parsed.attachments);
  
  const body = parsed.content || '';
  if (body.length < 50) {
      console.warn('Warning: Body content is short:', body.length);
  }

  console.log('Running AI Extraction...');
  // Pass parsed.attachments to AI to be merged and filtered
  const aiResult = await extractInformation(body, url, '通知公告-北京大学本科招生网', true, parsed.attachments);

  const rendered = buildWeComMarkdown(aiResult);

  console.log('\n================ RESULT ================');
  console.log('title:', aiResult.title || parsed.title);
  console.log('publish_date:', aiResult.publish_date || parsed.date);
  console.log('detail_url:', url);
  console.log('body_length:', body.length);
  console.log('attachments_count:', aiResult.attachments.length);
  console.log('attachments_sample:', aiResult.attachments.map(a => ({ name: a.name, url: a.url })));
  
  console.log('\n---------------- Rendered "Attachments" Section ----------------');
  // Extract just the attachments part from rendered text for easier viewing
  const lines = rendered.split('\n');
  let inAttachments = false;
  for (const line of lines) {
      if (line.includes('**附件**：')) {
          inAttachments = true;
          console.log(line);
      } else if (inAttachments) {
          if (line.startsWith('- ')) {
              console.log(line);
          } else if (line.trim() === '' || line.startsWith('[')) {
              inAttachments = false;
          }
      }
  }
  
  // Also print full rendered text if needed, but user asked for "Attachments" section specifically in the description
  // "渲染后的推送文本里“附件”部分最终长什么样"
  // But let's print the whole thing just in case.
  console.log('\n---------------- Full Rendered Text ----------------');
  console.log(rendered);

  const pushTest = args.includes('--push');
  const pushProd = args.includes('--prod');
  const testWebhook = process.env.WEWORK_TEST_WEBHOOK_URL;
  const prodWebhook = process.env.WEWORK_WEBHOOK_URL;

  if (!pushTest && !pushProd) {
    console.log('\n[SKIP] 未指定 --push 或 --prod 参数，跳过企业微信推送。');
    return;
  }

  if (pushProd) {
    if (!prodWebhook) {
      console.log('\n[SKIP] 未配置 WEWORK_WEBHOOK_URL，跳过正式企业微信推送。');
    } else {
      console.log('\n================ 开始推送到企业微信（正式群） ================');
      console.log('即将推送的 Markdown 文本如下：\n');
      console.log(rendered);
      try {
        await pushToWeCom(aiResult);
      } catch (e) {
        console.error('企业微信正式推送发生错误:', e);
      }
    }
  }

  if (pushTest) {
    if (!testWebhook) {
      console.log('\n[SKIP] 未配置 WEWORK_TEST_WEBHOOK_URL，跳过企业微信测试推送。');
      return;
    }

    console.log('\n================ 开始测试推送到企业微信（测试群） ================');
    console.log('即将推送的 Markdown 文本如下：\n');
    console.log(rendered);

    try {
      const res = await fetch(testWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: rendered }
        })
      });

      const resText = await res.text();
      console.log('\n================ 企业微信测试返回结果 ================');
      console.log('HTTP Status:', res.status);
      console.log('Response Body:', resText);
    } catch (e) {
      console.error('企业微信测试推送发生错误:', e);
    }
  }
}

main().catch(console.error);
