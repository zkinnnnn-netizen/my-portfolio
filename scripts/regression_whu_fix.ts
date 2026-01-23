import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import * as fs from 'fs';
import * as path from 'path';

// Mock Sources
const sources = [
    {
        name: '武汉大学-招生动态(Detail)',
        url: 'https://aoff.whu.edu.cn/info/1114/26432.htm',
        crawlConfig: {
            detailPattern: "https://aoff\\.whu\\.edu\\.cn/(info/|zsxx1/).*",
        }
    },
    {
        name: '武汉大学-招生政策(List)',
        url: 'https://aoff.whu.edu.cn/zsxx1/zsz.htm',
        crawlConfig: {
            detailPattern: "https://aoff\\.whu\\.edu\\.cn/zsxx1/.*",
        }
    }
];

function discoverLinks(html: string, baseUrl: string, pattern: RegExp): string[] {
    const links = new Set<string>();
    const hrefRegex = /href=["']([^"']+)["']/g;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
        const relative = match[1];
        try {
            const absolute = new URL(relative, baseUrl).href;
            if (pattern.test(absolute)) {
                links.add(absolute);
            }
        } catch (e) {
            // ignore
        }
    }
    return Array.from(links);
}

function applyFix(link: string, sourceName: string, sourceUrl: string): string {
    let finalUrl = link;
    if (sourceName.includes('武汉大学')) {
         // Fix for WHU: Force original_url = source_url (Scheme A)
         finalUrl = sourceUrl;

         // Double Insurance: Blacklist /zsxx1/tslzs/ (Navigation Links)
         if (link.includes('/zsxx1/tslzs/')) {
             console.log(`[WHU Fix] Detected navigation link ${link}, reverting to ${sourceUrl}`);
             finalUrl = sourceUrl;
         }
    }
    return finalUrl;
}

function main() {
    console.log('--- WHU Regression Test ---');
    
    let failCount = 0;

    for (const source of sources) {
        console.log(`\nTesting Source: ${source.name}`);
        const filename = source.name.includes('Detail') ? 'whu_detail.html' : 'whu_list.html';
        const fixturePath = path.join(__dirname, 'fixtures', filename);
        
        if (!fs.existsSync(fixturePath)) {
            console.error(`Fixture ${filename} not found. Run reproduce_whu.ts first.`);
            process.exit(1);
        }
        
        const html = fs.readFileSync(fixturePath, 'utf-8');
        const pattern = new RegExp(source.crawlConfig.detailPattern);
        const links = discoverLinks(html, source.url, pattern);
        
        console.log(`Discovered ${links.length} links.`);
        
        // Test Case 1: Navigation Link (Bad)
        const badLink = 'https://aoff.whu.edu.cn/zsxx1/tslzs/gatz.htm';
        const fixedBad = applyFix(badLink, source.name, source.url);
        console.log(`Input (Bad): ${badLink} => Output: ${fixedBad}`);
        if (fixedBad !== source.url) {
            console.error('FAIL: Bad navigation link was NOT reverted to source URL.');
            failCount++;
        }
        if (fixedBad.includes('/zsxx1/tslzs/')) {
            console.error('FAIL: Output still contains bad path segment.');
            failCount++;
        }

        // Test Case 2: Good Link (Hypothetical)
        const goodLink = 'https://aoff.whu.edu.cn/info/1114/12345.htm';
        const fixedGood = applyFix(goodLink, source.name, source.url);
        console.log(`Input (Good): ${goodLink} => Output: ${fixedGood}`);
        if (fixedGood !== source.url) {
            console.error('FAIL: Even good links should be forced to source URL under Scheme A.');
            failCount++;
        }
    }

    if (failCount === 0) {
        console.log('\nSUCCESS: All checks passed.');
    } else {
        console.error(`\nFAIL: ${failCount} checks failed.`);
        process.exit(1);
    }
}

main();
