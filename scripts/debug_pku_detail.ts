
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

async function main() {
    const url = 'https://www.gotopku.cn/tzgg/178e2332ccce4d9198e8d3d5eebdb656.htm';
    console.log(`Fetching ${url}...`);

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. Check raw selector
    const selector = '#articleDiv';
    const rawContent = $(selector);
    console.log('--- Raw Selector Check ---');
    console.log(`Selector "${selector}" found: ${rawContent.length} elements`);
    const rawText = rawContent.text().trim();
    console.log(`Raw innerText length: ${rawText.length}`);
    console.log(`Raw innerText preview (first 200): ${rawText.substring(0, 200).replace(/\s+/g, ' ')}`);

    // 2. Simulate Noise Removal
    const $clone = cheerio.load(html);
    // The list from lib/crawler.ts
    const noiseSelectors = 'nav, footer, header, aside, .nav, .footer, .header, .sidebar, script, style, .related, .comment';
    $clone(noiseSelectors).remove();

    const cleanedContent = $clone(selector);
    const cleanedText = cleanedContent.text().trim().replace(/\s+/g, ' ');
    console.log('\n--- After Noise Removal ---');
    console.log(`Cleaned innerText length: ${cleanedText.length}`);
    console.log(`Cleaned innerText preview (first 200): ${cleanedText.substring(0, 200)}`);

    // 3. Analysis & Deep Dive
    console.log('\n--- Deep Dive ---');
    console.log(`Parent of ${selector}: ${$(selector).parent().prop('tagName')}.${$(selector).parent().attr('class')}`);
    console.log(`Parent text length: ${$(selector).parent().text().trim().length}`);
    
    console.log(`\nHTML of ${selector}:`);
    console.log($(selector).html());

    console.log('\n--- Inspecting Parent .article-cont ---');
    const parent = $('.article-cont');
    if (parent.length > 0) {
        console.log(`Parent content preview (first 500):`);
        console.log(parent.text().trim().replace(/\s+/g, ' ').substring(0, 500));
        
        console.log('\nParent children structure:');
        parent.children().each((i, el) => {
            console.log(`  [${i}] ${el.tagName}.${$(el).attr('class')} (text len: ${$(el).text().trim().length})`);
        });
    }

    console.log('\n--- Searching for Title Element ---');
    const titleText = "北京大学2026年“数学英才班”测试结果查询通知";
    let titleEl: cheerio.Cheerio<any> | null = null;
    $('*').each((_, el) => {
        const $el = $(el);
        if ($el.children().length === 0 && $el.text().trim().includes(titleText)) {
            console.log(`Found title in: ${$el.prop('tagName')}.${$el.attr('class')} (Parent: ${$el.parent().prop('tagName')}.${$el.parent().attr('class')})`);
            titleEl = $el;
        }
    });

    if (titleEl) {
        // Find common ancestor with #articleDiv
        const contentEl = $('#articleDiv');
        if (contentEl.length > 0) {
            // Find closest common ancestor
            const commonAncestor = $(titleEl).parents().filter((_, el) => contentEl.parents().is(el)).first();
            console.log(`Common ancestor: ${commonAncestor.prop('tagName')}.${commonAncestor.attr('class')}`);
            console.log(`Ancestor text length (cleaned): ${commonAncestor.text().replace(/\s+/g, ' ').length}`);
            console.log(`Ancestor preview: ${commonAncestor.text().replace(/\s+/g, ' ').substring(0, 200)}`);
        }
    }

    console.log('\n--- Searching for Contact Info ---');
    const contactText = "010-62751407";
    let contactEl: cheerio.Cheerio<any> | null = null;
    $('*').each((_, el) => {
         const $el = $(el);
         if ($el.children().length === 0 && $el.text().includes(contactText)) {
             console.log(`Found contact in: ${$el.prop('tagName')}.${$el.attr('class')} (Parent: ${$el.parent().prop('tagName')}.${$el.parent().attr('class')})`);
             contactEl = $el;
         }
    });

    if (contactEl) {
        // Find common ancestor with #articleDiv
        const contentEl = $('#articleDiv');
        if (contentEl.length > 0) {
            const commonAncestor = $(contactEl).parents().filter((_, el) => contentEl.parents().is(el)).first();
            console.log(`Common ancestor (Content + Contact): ${commonAncestor.prop('tagName')}.${commonAncestor.attr('class')}`);
            const cleaned = commonAncestor.text().replace(/\s+/g, ' ');
            console.log(`Ancestor text length (cleaned): ${cleaned.length}`);
            console.log(`Ancestor preview: ${cleaned.substring(0, 200)}`);
        }

        // Find best footer selector
        const footerContainer = $(contactEl).parentsUntil('body').filter((_, el) => $(el).text().length < 500).last();
        console.log(`Footer Candidate: ${footerContainer.prop('tagName')}.${footerContainer.attr('class')}`);
        console.log(`Footer text: ${footerContainer.text().replace(/\s+/g, ' ').substring(0, 100)}...`);
    }

    console.log('\n--- Inspecting DIV.x-wrap ---');
    const wrap = $('.x-wrap');
    if (wrap.length > 0) {
        wrap.children().each((i, el) => {
             const t = $(el).text().replace(/\s+/g, ' ').trim();
             console.log(`  [${i}] ${el.tagName}.${$(el).attr('class')} (len: ${t.length}, preview: ${t.substring(0, 50)})`);
        });
    }

    // 4. Inspect Menu
    console.log('\n--- Inspecting Menu Container ---');
    const menuText = "招生类别";
    $('*').each((_, el) => {
         const $el = $(el);
         if ($el.children().length === 0 && $el.text().includes(menuText)) {
             // Find the top-level menu container (e.g. direct child of x-layout or body)
             const menuContainer = $el.parentsUntil('body').last();
             console.log(`Menu found in: ${$el.prop('tagName')}.${$el.attr('class')}`);
             console.log(`Menu Container: ${menuContainer.prop('tagName')}.${menuContainer.attr('class')}`);
             console.log(`Menu Container classes: ${menuContainer.attr('class')}`);
         }
    });

    // 5. Test Combined Selector
    console.log('\n--- Combined Selector Test ---');
    const combinedSelector = '.x-wrap, .mod.mod2';
    const $combined = cheerio.load(html);
    $combined('nav, footer, header, aside, .nav, .footer, .header, .sidebar, script, style, .related, .comment').remove();
    
    let combinedText = '';
    $combined(combinedSelector).each((_, el) => {
        combinedText += $combined(el).text() + ' ';
    });
    combinedText = combinedText.replace(/\s+/g, ' ').trim();
    
    console.log(`Combined Selector: "${combinedSelector}"`);
    console.log(`Combined Text Length: ${combinedText.length}`);
    console.log(`Combined Text Preview: ${combinedText.substring(0, 200)}`);
    
    if (combinedText.length > 300) {
        console.log('SUCCESS: Combined selector meets length requirement > 300');
    } else {
        console.log(`FAILURE: Combined selector length ${combinedText.length} < 300`);
    }

    // 6. Test Readability Fallback
    console.log('\n--- Readability Fallback Test ---');
    const doc = new JSDOM(html, { url });
    // Simulate noise removal on JSDOM document? 
    // Readability does its own noise removal, but Crawler does pre-cleaning.
    // Let's try raw Readability first.
    const reader = new Readability(doc.window.document);
    const article = reader.parse();
    if (article) {
        console.log(`Readability Title: ${article.title}`);
        console.log(`Readability Content Length: ${article.textContent.length}`);
        console.log(`Readability Content Preview: ${article.textContent.substring(0, 200).replace(/\s+/g, ' ')}`);
    } else {
        console.log('Readability failed to parse article.');
    }

    if (rawText.length > 300 && cleanedText.length < 100) {
        console.log('\n[!] WARNING: Noise removal deleted too much content.');
        // Try to find which selector is guilty
        const selectors = noiseSelectors.split(',').map(s => s.trim());
        for (const s of selectors) {
            const $temp = cheerio.load(html);
            const before = $temp(selector).text().length;
            $temp(s).remove();
            const after = $temp(selector).text().length;
            if (after < before * 0.5) { // If removed more than 50%
                 console.log(`    -> Culprit might be: "${s}" (reduced length from ${before} to ${after})`);
            }
        }
    } else if (rawText.length < 100) {
        console.log('\n[!] WARNING: Raw selector content is too short. Selector might be wrong.');
        // Try to find a better container
        const candidates = ['article', '.article', '.content', '.main', '#content', '#main', '.container', '.wrapper', 'body'];
        console.log('Checking candidates:');
        for (const c of candidates) {
            const txt = $(c).text().trim().replace(/\s+/g, ' ');
            if (txt.length > 200) {
                console.log(`  Candidate "${c}": length=${txt.length}, preview=${txt.substring(0, 50)}...`);
            }
        }

        // Find the element with the most text
        console.log('\n--- Searching for the element with the most text ---');
        let maxLen = 0;
        let bestEl = '';
        let bestText = '';
        
        $('div, article, section, p, table').each((_, el) => {
            // Ignore if it has too many children (container)
            if ($(el).children().length > 5) return;
            
            const t = $(el).text().trim().replace(/\s+/g, ' ');
            if (t.length > maxLen) {
                maxLen = t.length;
                bestEl = `${el.tagName}${$(el).attr('id') ? '#' + $(el).attr('id') : ''}${$(el).attr('class') ? '.' + $(el).attr('class') : ''}`;
                bestText = t;
            }
        });
        
        console.log(`Best Candidate: ${bestEl} (Length: ${maxLen})`);
        console.log(`Preview: ${bestText.substring(0, 200)}`);

    } else {
        console.log('\nContent length seems okay or issue is elsewhere.');
    }
}

main().catch(console.error);
