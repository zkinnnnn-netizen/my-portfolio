
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import prisma from '../lib/prisma';
import { Crawler } from '../lib/crawler';

const RISK_KEYWORDS = ["联系", "联系我们", "联系方式", "导航", "网站地图", "下载", "招生咨询", "常见问题", "FAQ", "查询", "登录", "注册"];

interface AuditResult {
  sourceName: string;
  listUrl: string;
  fetchedCandidatesCount: number;
  riskHitCount: number;
  sampleRiskTitles: string[];
  sampleRiskUrls: string[];
}

async function main() {
  console.log('Starting list quality audit for active HTML sources...');

  const sources = await prisma.source.findMany({
    where: {
      isActive: true,
      type: 'HTML'
    }
  });

  console.log(`Found ${sources.length} active HTML sources.`);

  const results: AuditResult[] = [];

  for (const source of sources) {
    console.log(`Auditing: ${source.name}...`);
    let config: any = {};
    try {
        config = typeof source.crawlConfig === 'string' 
          ? JSON.parse(source.crawlConfig) 
          : source.crawlConfig || {};
    } catch (e) {
        console.error(`Failed to parse config for ${source.name}`);
        continue;
    }

    const listUrl = (config.listUrls && config.listUrls.length > 0) ? config.listUrls[0] : source.url;
    if (!listUrl) {
        console.warn(`No list URL for ${source.name}`);
        continue;
    }

    const crawler = new Crawler(config);
    
    try {
        const fetchRes = await crawler.fetch(listUrl);
        if (fetchRes.status !== 200 || !fetchRes.content) {
            console.error(`Fetch failed for ${source.name} (${fetchRes.status})`);
            continue;
        }

        const items = crawler.parseList(fetchRes.content, listUrl, config);
        const candidates = items.slice(0, 30);
        
        let riskHits = 0;
        const riskTitles: string[] = [];
        const riskUrls: string[] = [];

        for (const item of candidates) {
            const title = item.title || '';
            const isShort = title.length > 0 && title.length < 6;
            const hasKeyword = RISK_KEYWORDS.some(kw => title.includes(kw));
            
            if (isShort || hasKeyword) {
                riskHits++;
                if (riskTitles.length < 3) riskTitles.push(title || '(No Title)');
                if (riskUrls.length < 3) riskUrls.push(item.url);
            }
        }

        results.push({
            sourceName: source.name,
            listUrl,
            fetchedCandidatesCount: candidates.length,
            riskHitCount: riskHits,
            sampleRiskTitles: riskTitles,
            sampleRiskUrls: riskUrls
        });

    } catch (e: any) {
        console.error(`Error auditing ${source.name}:`, e.message);
    }
  }

  // Sort by riskHitCount desc
  results.sort((a, b) => b.riskHitCount - a.riskHitCount);

  console.log('\n=== Audit Results ===');
  // Print as a table-like format manually or use console.table with selected fields
  // console.table truncates long strings, so maybe manual is better for URLs?
  // Let's use console.table for the main stats
  
  const tableData = results.map(r => ({
      Source: r.sourceName,
      Count: r.fetchedCandidatesCount,
      RiskHits: r.riskHitCount,
      TopRiskTitle: r.sampleRiskTitles[0] || '',
      TopRiskUrl: r.sampleRiskUrls[0] || ''
  }));

  console.table(tableData);

  console.log('\n=== Recommendations ===');
  for (const r of results) {
      if (r.riskHitCount >= 3) {
          console.log(`🔴 [High Risk] ${r.sourceName} (Hits: ${r.riskHitCount}) -> 建议补充 listSelectors.item 限定公告列表容器`);
      } else if (r.riskHitCount >= 1) {
          console.log(`🟡 [Medium Risk] ${r.sourceName} (Hits: ${r.riskHitCount}) -> 建议观察`);
      }
  }
  
  const cleanCount = results.filter(r => r.riskHitCount === 0).length;
  console.log(`🟢 [Healthy] ${cleanCount} sources have 0 risk hits.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
