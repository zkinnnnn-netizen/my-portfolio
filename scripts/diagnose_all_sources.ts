import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

// Read manual_sources.json
const sourcesPath = path.join(__dirname, '../manual_sources.json');
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));

const HTML_SOURCES = sources.filter((s: any) => s.type === 'HTML');

console.log(`Found ${HTML_SOURCES.length} HTML sources.`);

async function fetchAndDiagnose(source: any) {
    console.log(`Checking ${source.name}...`);
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(source.url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            console.error(`[${source.name}] Failed to fetch: ${response.status}`);
            return null;
        }

        const html = await response.text();
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const baseUrl = source.url;

        // Simulate Ingest Logic (Simplified)
        const anchors = Array.from(doc.querySelectorAll('a'));
        const detailPattern = new RegExp(source.crawlConfig.detailPattern);
        
        let firstMatch: string | null = null;
        let firstMatchText: string | null = null;

        for (const a of anchors) {
            const href = a.getAttribute('href');
            if (!href) continue;
            
            try {
                const absolute = new URL(href, baseUrl).href;
                if (detailPattern.test(absolute)) {
                    firstMatch = absolute;
                    firstMatchText = a.textContent?.trim() || '';
                    break; // Simulate picking the first one
                }
            } catch (e) {
                // ignore
            }
        }

        if (!firstMatch) {
            console.log(`[${source.name}] No links matched detailPattern.`);
            return { source, status: 'NO_MATCH' };
        }

        // Diagnosis
        const issues = [];
        
        // 1. Pagination Check
        if (firstMatch.match(/(list|page|index)\d+\.(htm|jsp|php|aspx)/i) || firstMatch.includes('page=')) {
             issues.push('Likely Pagination Link');
        }

        // 2. Navigation/Directory Check (Heuristic)
        // If the link is shorter than source url or looks like a parent directory
        if (firstMatch.length < source.url.length && source.url.includes(firstMatch)) {
            issues.push('Parent Directory/Navigation');
        }
        
        // 3. Keyword Check in Text
        if (firstMatchText && (firstMatchText.includes('更多') || firstMatchText.includes('Next') || firstMatchText.includes('下页'))) {
            issues.push('Navigation Text ("More/Next")');
        }

        // 4. Same Path Check (Loop)
        if (firstMatch === source.url) {
            issues.push('Self Loop');
        }

        if (issues.length > 0) {
            console.log(`[${source.name}] ⚠️ SUSPICIOUS: ${firstMatch} (${issues.join(', ')})`);
            return { source, status: 'SUSPICIOUS', link: firstMatch, issues };
        } else {
            // console.log(`[${source.name}] OK: ${firstMatch}`);
            return { source, status: 'OK', link: firstMatch };
        }

    } catch (e) {
        console.error(`[${source.name}] Error: ${(e as Error).message}`);
        return null;
    }
}

async function main() {
    const results = [];
    // Process in chunks to avoid overwhelming network
    const chunkSize = 5;
    for (let i = 0; i < HTML_SOURCES.length; i += chunkSize) {
        const chunk = HTML_SOURCES.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(fetchAndDiagnose));
        results.push(...chunkResults);
    }

    const suspicious = results.filter(r => r && r.status === 'SUSPICIOUS');
    
    console.log('\n--- DIAGNOSIS REPORT ---');
    console.log(`Total Checked: ${results.length}`);
    console.log(`Suspicious: ${suspicious.length}`);
    
    suspicious.forEach((r: any) => {
        console.log(`\n🔴 Source: ${r.source.name}`);
        console.log(`   URL: ${r.source.url}`);
        console.log(`   Picked: ${r.link}`);
        console.log(`   Issues: ${r.issues.join(', ')}`);
        console.log(`   Config Pattern: ${r.source.crawlConfig.detailPattern}`);
    });

    // Generate Fix Suggestion Code
    if (suspicious.length > 0) {
        console.log('\n--- SUGGESTED FIXES (for ingest.ts) ---');
        console.log('// Copy this into applyFix logic or similar');
        suspicious.forEach((r: any) => {
             console.log(`// ${r.source.name}: ${r.issues.join(', ')}`);
        });
    }
}

main();
