import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import * as fs from 'fs';
import * as path from 'path';

// Mock the Crawler behavior
function discoverLinks(html: string, baseUrl: string, pattern: RegExp | undefined): string[] {
    const links = new Set<string>();
    // Simple href extractor for test
    const hrefRegex = /href=["']([^"']+)["']/g;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
        const relative = match[1];
        try {
            const absolute = new URL(relative, baseUrl).href;
            if (pattern) {
                if (pattern.test(absolute)) {
                    links.add(absolute);
                }
            } else {
                links.add(absolute);
            }
        } catch (e) {
            // ignore invalid urls
        }
    }
    return Array.from(links);
}

function main() {
    const fixturePath = path.join(__dirname, 'fixtures', 'tju_tzgg.html');
    if (!fs.existsSync(fixturePath)) {
        console.error('Fixture not found. Run reproduce_tju.ts first.');
        process.exit(1);
    }
    const html = fs.readFileSync(fixturePath, 'utf-8');
    const baseUrl = 'https://zs.tju.edu.cn/ym21/bkzn/tzgg.htm';

    // The regex we added in ingest.ts
    // config.detailPattern = 'https://zs\\.tju\\.edu\\.cn/(info/.*|ym21/bkzn/tzgg\\.htm)';
    const newPattern = new RegExp('https://zs\\.tju\\.edu\\.cn/(info/.*|ym21/bkzn/tzgg\\.htm)');
    
    // The old pattern (from manual_sources.json)
    const oldPattern = new RegExp('https://zs\\.tju\\.edu\\.cn/ym21/bkzn/.*');

    console.log('--- Testing OLD Pattern ---');
    const oldLinks = discoverLinks(html, baseUrl, oldPattern);
    console.log(`Found ${oldLinks.length} links.`);
    const badLinks = oldLinks.filter(l => l.includes('ztzs') || l.includes('gspydd'));
    console.log(`Bad links (ztzs/gspydd): ${badLinks.length}`);
    if (badLinks.length > 0) {
        console.log(`Sample bad link: ${badLinks[0]}`);
    }

    console.log('\n--- Testing NEW Pattern ---');
    const newLinks = discoverLinks(html, baseUrl, newPattern);
    console.log(`Found ${newLinks.length} links.`);
    
    const infoLinks = newLinks.filter(l => l.includes('/info/'));
    console.log(`Real items (info): ${infoLinks.length}`);
    infoLinks.slice(0, 5).forEach(l => console.log(`  ${l}`));

    const badLinksNew = newLinks.filter(l => l.includes('ztzs') || l.includes('gspydd'));
    console.log(`Bad links (ztzs/gspydd): ${badLinksNew.length}`);

    // Assertions
    if (badLinksNew.length > 0) {
        console.error('FAIL: New pattern still matches bad links.');
        process.exit(1);
    }
    if (infoLinks.length === 0) {
        console.error('FAIL: New pattern does NOT match info links.');
        process.exit(1);
    }

    console.log('\nSUCCESS: New pattern correctly filters bad links and includes real items.');
}

main();
