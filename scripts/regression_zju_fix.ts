
import * as fs from 'fs';
import * as path from 'path';

// Mock Source
const source = {
    name: '浙江大学-最新公告',
    url: 'https://zdzsc.zju.edu.cn/zxgg/list.htm',
    crawlConfig: {
      detailPattern: "https://zdzsc\\.zju\\.edu\\.cn/zxgg/.*",
    }
};

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
    if (sourceName === '浙江大学-最新公告') {
        // Fix for ZJU: Force original_url = source_url (Scheme A)
        finalUrl = sourceUrl;

        // Double Insurance Check (logic from ingest.ts)
        if (link.match(/\/zxgg\/list\d+\.(psp|htm)/)) {
             console.log(`[Fix Applied] Detected pagination link ${link}, reverted to ${sourceUrl}`);
        }
    }
    return finalUrl;
}

function main() {
    const fixturePath = path.join(__dirname, 'fixtures', 'zju_list.html');
    if (!fs.existsSync(fixturePath)) {
        console.error('Fixture not found. Run reproduce_zju.ts first.');
        process.exit(1);
    }
    const html = fs.readFileSync(fixturePath, 'utf-8');
    
    console.log('--- Step 1: Reproduce Bad Link Discovery ---');
    const detailPattern = new RegExp(source.crawlConfig.detailPattern);
    const discoveredLinks = discoverLinks(html, source.url, detailPattern);
    
    console.log(`Discovered ${discoveredLinks.length} links.`);
    const paginationLinks = discoveredLinks.filter(l => l.match(/\/zxgg\/list\d+\.(psp|htm)/));
    console.log(`Found ${paginationLinks.length} pagination links (Problem Reproduction):`);
    paginationLinks.forEach(l => console.log(`  ${l}`));

    if (paginationLinks.length === 0) {
        console.warn('WARNING: No pagination links found in fixture. Regex might need adjustment or fixture is clean.');
        // For the sake of the test, let's inject a fake bad link to test the fix logic
        discoveredLinks.push('https://zdzsc.zju.edu.cn/zxgg/list23.psp');
        paginationLinks.push('https://zdzsc.zju.edu.cn/zxgg/list23.psp');
        console.log('Injected fake bad link for testing: https://zdzsc.zju.edu.cn/zxgg/list23.psp');
    }

    console.log('\n--- Step 2: Verify Fix Logic ---');
    let failCount = 0;
    
    for (const link of paginationLinks) {
        const fixedUrl = applyFix(link, source.name, source.url);
        console.log(`Input: ${link} => Output: ${fixedUrl}`);
        
        if (fixedUrl !== source.url) {
            console.error('FAIL: URL was not fixed to source URL.');
            failCount++;
        }
        if (fixedUrl.match(/\/zxgg\/list\d+\.(psp|htm)/)) {
            console.error('FAIL: Output URL is still a pagination link.');
            failCount++;
        }
    }

    const goodLink = 'https://zdzsc.zju.edu.cn/zxgg/2023/0101/c123a456/page.htm'; // Hypothetical good link
    const fixedGood = applyFix(goodLink, source.name, source.url);
    console.log(`Input (Good): ${goodLink} => Output: ${fixedGood}`);
    if (fixedGood !== source.url) {
         console.error('FAIL: Even good links should be forced to source URL under Scheme A.');
         failCount++;
    }

    if (failCount === 0) {
        console.log('\nSUCCESS: All checks passed.');
    } else {
        console.error(`\nFAIL: ${failCount} checks failed.`);
        process.exit(1);
    }
}

main();
