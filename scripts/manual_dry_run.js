const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Helper for fetch with timeout
const FETCH_TIMEOUT_MS = 10000;
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function run() {
  const filePath = path.join(__dirname, '../manual_sources.json');
  if (!fs.existsSync(filePath)) {
    console.error("manual_sources.json not found");
    return;
  }
  const sources = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Pick 3 random
  const shuffled = sources.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 3);

  console.log(`Selected 3 sources for dry-run:`);
  selected.forEach(s => console.log(`- ${s.name} (${s.url})`));
  console.log('---');

  const supplementList = [];

  for (const source of selected) {
    console.log(`\nTesting ${source.name}...`);
    try {
      // 1. Fetch List
      console.log(`Fetching list: ${source.url}`);
      const listRes = await fetchWithTimeout(source.url);
      if (!listRes.ok) throw new Error(`List fetch failed: ${listRes.status}`);
      const listHtml = await listRes.text();
      const $ = cheerio.load(listHtml);

      // 2. Extract Detail Links
      const config = source.crawlConfig;
      // Safety check for detailPattern
      if (!config.detailPattern) {
        throw new Error("No detailPattern in config");
      }
      
      const detailPatternRegex = new RegExp(config.detailPattern);
      
      const links = [];
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        try {
          const u = new URL(href, source.url);
          // Simple filtering for files
          if (u.pathname.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|jpg|png)$/i)) return;
          
          if (detailPatternRegex.test(u.href)) {
            links.push(u.href);
          }
        } catch (e) {}
      });

      console.log(`Found ${links.length} potential detail links.`);
      if (links.length === 0) {
        console.warn(`[WARN] No detail links matched pattern: ${config.detailPattern}`);
        supplementList.push({ name: source.name, url: source.url, reason: `No detail links found (pattern: ${config.detailPattern})` });
        continue;
      }

      // 3. Fetch One Detail
      const detailUrl = links[0];
      console.log(`Fetching detail: ${detailUrl}`);
      const detailRes = await fetchWithTimeout(detailUrl);
      if (!detailRes.ok) throw new Error(`Detail fetch failed: ${detailRes.status}`);
      const detailHtml = await detailRes.text();
      const $d = cheerio.load(detailHtml);

      // 4. Extract Content (Heuristic)
      // Title
      let title = $d('h1').first().text().trim() || $d('.title').first().text().trim() || $d('#title').text().trim() || $d('title').text().trim();
      
      // Date (Simple regex search in body text or common classes)
      let date = "";
      const dateRegex = /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})/;
      // Try to find in common meta/divs
      const bodyText = $d('body').text();
      const dateMatch = bodyText.match(dateRegex);
      if (dateMatch) date = dateMatch[0];

      // Content Length
      // Remove scripts, styles
      $d('script').remove();
      $d('style').remove();
      const cleanText = $d('body').text().replace(/\s+/g, ' ').trim();
      const contentLength = cleanText.length;

      console.log(`  Title: ${title.substring(0, 50)}...`);
      console.log(`  Date: ${date}`);
      console.log(`  Content Length: ${contentLength}`);

      // Check if selectors needed
      const needsSelector = [];
      if (!title || title.length < 5 || title.includes("Loading") || title.includes("正在加载")) needsSelector.push("title");
      if (!date) needsSelector.push("date");
      if (contentLength < 100) needsSelector.push("content");

      if (needsSelector.length > 0) {
        console.log(`  -> Needs selectors: ${needsSelector.join(', ')}`);
        supplementList.push({ 
          name: source.name, 
          url: source.url,
          sampleDetail: detailUrl,
          missing: needsSelector 
        });
      } else {
        console.log(`  -> Looks good!`);
      }

    } catch (e) {
      console.error(`  Error: ${e.message}`);
      supplementList.push({ name: source.name, url: source.url, reason: `Error: ${e.message}` });
    }
  }

  console.log('\n\n=== Selector Supplement List ===');
  if (supplementList.length === 0) {
    console.log("No obvious issues found in this batch.");
  } else {
    supplementList.forEach(item => {
      if (item.missing) {
        console.log(`[${item.name}]`);
        console.log(`  List: ${item.url}`);
        console.log(`  Sample Detail: ${item.sampleDetail}`);
        console.log(`  Missing: ${item.missing.join(', ')}`);
      } else {
        console.log(`[${item.name}]`);
        console.log(`  List: ${item.url}`);
        console.log(`  Reason: ${item.reason}`);
      }
      console.log('---');
    });
  }
}

run();
