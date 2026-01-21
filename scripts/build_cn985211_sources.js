const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const MOE_985_URL = 'https://www.moe.gov.cn/srcsite/A22/s7065/200612/t20061206_128833.html';
const MOE_211_URL = 'https://www.moe.gov.cn/srcsite/A22/s7065/200512/t20051223_82762.html';
const CACHE_DIR = path.join(__dirname, 'cache');
const DEMIRED_URL =
  'https://raw.githubusercontent.com/Demired/Domain-names-of-Chinese-universities/master/edu.json';
const DEMIRED_FILE = path.join(CACHE_DIR, 'edu.json');
const HIPO_URL =
  'https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json';
const HIPO_FILE = path.join(CACHE_DIR, 'universities.json');
const COLLEGES_URL =
  'https://raw.githubusercontent.com/CollegesChat/China-Mainland-Universities-Domain-Suffix/master/data.json';
const COLLEGES_FILE = path.join(CACHE_DIR, 'china_univ_suffix.json');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 8000;
const PER_SCHOOL_BUDGET_MS = 8000;
const MAX_CONCURRENT_CHECKS = 5;
const STRONG_WORDS = [
  '通知公告',
  '公告',
  '公示',
  '通知',
  '招标',
  '采购',
  '遴选',
  '招聘',
  '考试',
  '报名',
  '结果',
  '名单',
  '简章',
];
const WEAK_WORDS = ['新闻', '动态', '快讯', '要闻'];
const NEGATIVE_WORDS = ['新闻网', '要闻', '媒体报道', '媒体'];

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const finalOptions = { ...options, signal: controller.signal };
  try {
    const res = await fetch(url, finalOptions);
    return res;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error('TimeoutError');
      e.isTimeout = true;
      e.url = url;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

// Light rate limiter for same domain
const domainLastRequest = new Map();
async function rateLimit(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const last = domainLastRequest.get(host) || 0;
    const now = Date.now();
    const diff = now - last;
    if (diff < 500) { // Limit to ~2 req/s
      await new Promise(resolve => setTimeout(resolve, 500 - diff));
    }
    domainLastRequest.set(host, Date.now());
  } catch (e) {
    // Ignore invalid URL
  }
}

function getRemainingTime(deadline, fallback) {
  if (!deadline) return fallback;
  const now = Date.now();
  const remaining = deadline - now;
  if (remaining <= 0) return 0;
  if (fallback == null) return remaining;
  return Math.min(fallback, remaining);
}

async function fetchHtml(url, timeoutMs, deadline) {
  if (deadline && Date.now() >= deadline) {
    const e = new Error('BudgetExceeded');
    e.isTimeout = true;
    e.isBudgetExceeded = true;
    throw e;
  }
  await rateLimit(url);
  const effectiveTimeout = timeoutMs != null ? timeoutMs : FETCH_TIMEOUT_MS;
  const remaining = getRemainingTime(deadline, effectiveTimeout);
  if (remaining <= 0) {
    const e = new Error('BudgetExceeded');
    e.isTimeout = true;
    e.isBudgetExceeded = true;
    throw e;
  }
  await rateLimit(url);
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, remaining);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return await res.text();
}

function extractNamesFromHtml(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const regex = /[\u4e00-\u9fa5]{2,}(大学|学院)/g;
  const set = new Set();
  let m;
  while ((m = regex.exec(text)) !== null) {
    const name = m[0];
    if (name.length <= 20) {
      set.add(name);
    }
  }
  return Array.from(set);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function loadJsonWithCache(url, filePath) {
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath)) {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  }
  console.log('Downloading dataset: ' + url);
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error('Failed to download dataset ' + url + ' status=' + res.status);
  }
  const text = await res.text();
  fs.writeFileSync(filePath, text, 'utf8');
  return JSON.parse(text);
}

function isChinese(str) {
  return /[\u4e00-\u9fa5]/.test(str);
}

function normalizeName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/[\s·•・．]/g, '');
  s = s.replace(/（[^）]*）/g, '');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/[\"“”《》]/g, '');
  return s;
}

function extractChineseNameFromRecord(record) {
  let best = null;
  const entries = Object.entries(record);
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      const v = value.trim();
      if (!isChinese(v)) continue;
      if (v.length > 40) continue;
      if (v.includes('大学') || v.includes('学院') || v.length >= 4) {
        best = v;
        break;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const v = item.trim();
        if (!isChinese(v)) continue;
        if (v.length > 40) continue;
        if (v.includes('大学') || v.includes('学院') || v.length >= 4) {
          best = v;
          break;
        }
      }
      if (best) break;
    }
  }
  return best;
}

function collectDomainCandidatesFromString(text) {
  const results = [];
  if (!text || typeof text !== 'string') return results;
  const str = text.trim();
  if (!str) return results;
  if (str.includes('@')) return results;
  const urlPattern = /(https?:\/\/[^\s"']+)/gi;
  let m;
  while ((m = urlPattern.exec(str)) !== null) {
    results.push(m[1]);
  }
  const domainPattern = /([a-z0-9-]+\.)+[a-z]{2,}/gi;
  while ((m = domainPattern.exec(str)) !== null) {
    results.push(m[0]);
  }
  return results;
}

function extractDomainsFromRecord(record) {
  const set = new Set();
  const values = Object.values(record);
  for (const value of values) {
    if (typeof value === 'string') {
      const candidates = collectDomainCandidatesFromString(value);
      for (const c of candidates) set.add(c);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const candidates = collectDomainCandidatesFromString(item);
        for (const c of candidates) set.add(c);
      }
    }
  }
  return Array.from(set);
}

function normalizeDomain(domain) {
  if (!domain) return null;
  let d = String(domain).trim();
  if (!d) return null;
  if (!/^https?:\/\//i.test(d)) {
    d = 'https://' + d;
  }
  try {
    const u = new URL(d);
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host;
  } catch (e) {
    return null;
  }
}

function pickBestDomain(domains) {
  if (!domains || domains.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const raw of domains) {
    const host = normalizeDomain(raw);
    if (!host) continue;
    let score = 0;
    if (host.endsWith('.edu.cn')) score += 5;
    else if (host.endsWith('.edu')) score += 4;
    else score += 2;
    const parts = host.split('.');
    if (parts.length <= 3) score += 1;
    if (parts.length > 3) score -= 0.5;
    score -= host.length * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = host;
    }
  }
  return best;
}

async function buildDomainLookup() {
  const map = new Map();
  let demiredData = null;
  let collegesData = null;
  let hipoData = null;
  try {
    demiredData = await loadJsonWithCache(DEMIRED_URL, DEMIRED_FILE);
  } catch (e) {
    console.error('Failed to load Demired edu.json:', e.message || e);
  }
  try {
    collegesData = await loadJsonWithCache(COLLEGES_URL, COLLEGES_FILE);
  } catch (e) {
    console.error('Failed to load CollegesChat data.json:', e.message || e);
  }
  try {
    hipoData = await loadJsonWithCache(HIPO_URL, HIPO_FILE);
  } catch (e) {
    console.error('Failed to load Hipo universities.json:', e.message || e);
  }

  function addFromArray(data, sourceTag) {
    if (!Array.isArray(data)) return;
    for (const record of data) {
      if (!record || typeof record !== 'object') continue;
      const name = extractChineseNameFromRecord(record);
      if (!name) continue;
      const domains = extractDomainsFromRecord(record);
      const bestDomain = pickBestDomain(domains);
      if (!bestDomain) continue;
      const canonical = normalizeName(name);
      if (!canonical) continue;
      if (!map.has(canonical)) {
        map.set(canonical, {
          name,
          host: bestDomain,
          source: sourceTag,
        });
      }
    }
  }

  addFromArray(demiredData, 'demired');
  addFromArray(collegesData, 'collegeschat');
  addFromArray(hipoData, 'hipo');

  return map;
}

function buildAliasMap() {
  const aliases = {
    北京大学: ['北大'],
    清华大学: ['清华'],
    中国人民大学: ['人大'],
    中国科学技术大学: ['中科大'],
    北京航空航天大学: ['北航'],
    北京理工大学: ['北理工'],
    北京师范大学: ['北师大'],
    复旦大学: ['复旦'],
    上海交通大学: ['上交', '上海交大'],
    南京大学: ['南大'],
    浙江大学: ['浙大'],
    武汉大学: ['武大'],
    华中科技大学: ['华中大'],
    中山大学: ['中大'],
    厦门大学: ['厦大'],
    山东大学: ['山大'],
    中国海洋大学: ['海大'],
    西安交通大学: ['西交', '西安交大'],
    西北工业大学: ['西工大'],
    哈尔滨工业大学: ['哈工大'],
  };
  const map = new Map();
  for (const [full, arr] of Object.entries(aliases)) {
    const canonFull = normalizeName(full);
    const list = [];
    for (const a of arr) {
      list.push(normalizeName(a));
    }
    map.set(canonFull, list);
  }
  return map;
}

function resolveDomainForUniversity(uniName, domainLookup, aliasMap) {
  const canonical = normalizeName(uniName);
  if (!canonical) return null;
  const direct = domainLookup.get(canonical);
  if (direct) {
    return {
      host: direct.host,
      source: direct.source,
      note: 'direct_match',
    };
  }

  const aliasList = aliasMap.get(canonical) || [];
  for (const aliasCanon of aliasList) {
    const m = domainLookup.get(aliasCanon);
    if (m) {
      return {
        host: m.host,
        source: m.source,
        note: 'alias_match',
      };
    }
  }

  for (const [key, value] of domainLookup.entries()) {
    if (key.includes(canonical) || canonical.includes(key)) {
      return {
        host: value.host,
        source: value.source,
        note: 'fuzzy_match',
      };
    }
  }

  return null;
}

async function loadUniversities() {
  const map = new Map();

  async function fetchAndAdd(url, tag) {
    console.log(`Fetching MOE list: ${url}`);
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      throw new Error(`Failed to fetch MOE page: ${url}, status=${res.status}`);
    }
    const html = await res.text();
    const names = extractNamesFromHtml(html);
    console.log(`Found ${names.length} candidate names from ${url}`);
    for (const name of names) {
      let rec = map.get(name);
      if (!rec) {
        rec = {
          name,
          tags: new Set(),
          domain: null,
          domainSource: null,
          listUrl: null,
          confidence: 0,
          notes: '',
        };
        map.set(name, rec);
      }
      rec.tags.add(tag);
      if (tag === '985') {
        rec.tags.add('211');
      }
    }
  }

  await fetchAndAdd(MOE_985_URL, '985');
  await fetchAndAdd(MOE_211_URL, '211');

  const result = [];
  for (const rec of map.values()) {
    result.push({
      name: rec.name,
      tags: Array.from(rec.tags),
      domain: rec.domain,
      domainSource: rec.domainSource,
      listUrl: rec.listUrl,
      confidence: rec.confidence,
      notes: rec.notes,
    });
  }
  return result;
}

function scoreLinkText(text) {
  if (!text) return 0;
  const t = text.trim();
  if (!t) return 0;
  let score = 0;
  for (const k of STRONG_WORDS) {
    if (t.includes(k)) {
      score += 12;
      break;
    }
  }
  for (const k of WEAK_WORDS) {
    if (t.includes(k)) {
      score += 3;
      break;
    }
  }
  if (t.includes('登录') || t.toLowerCase().includes('login')) score -= 40;
  if (t.toLowerCase().includes('english')) score -= 40;
  if (t.includes('邮箱')) score -= 40;
  for (const k of NEGATIVE_WORDS) {
    if (t.includes(k)) {
      score -= 20;
      break;
    }
  }
  return score;
}

function collectKeywordHits(text) {
  const strongHits = [];
  const weakHits = [];
  if (!text) return { strongHits, weakHits };
  const t = text.trim();
  if (!t) return { strongHits, weakHits };
  for (const k of STRONG_WORDS) {
    if (t.includes(k) && !strongHits.includes(k)) strongHits.push(k);
  }
  for (const k of WEAK_WORDS) {
    if (t.includes(k) && !weakHits.includes(k)) weakHits.push(k);
  }
  return { strongHits, weakHits };
}

function scoreListPage($, url) {
  const bodyText = $('body').text();
  const datePatterns = [
    /\d{4}-\d{1,2}-\d{1,2}/g,
    /\d{4}\.\d{1,2}\.\d{1,2}/g,
    /\d{4}\/\d{1,2}\/\d{1,2}/g,
    /\d{2}-\d{1,2}/g,
  ];
  let dateCount = 0;
  for (const p of datePatterns) {
    const matches = bodyText.match(p);
    if (matches) dateCount += matches.length;
  }

  const links = $('a');
  let linkCount = 0;
  const strongHits = [];
  const weakHits = [];
  links.each((_, el) => {
    const txt = $(el).text().trim();
    if (!txt) return;
    linkCount++;
    const hits = collectKeywordHits(txt);
    for (const k of hits.strongHits) {
      if (!strongHits.includes(k)) strongHits.push(k);
    }
    for (const k of hits.weakHits) {
      if (!weakHits.includes(k)) weakHits.push(k);
    }
  });

  const titleText = $('title').text() + $('h1,h2,h3,.title,.bt,.btit,.bt_tit,.column-name,.columntitle,.tit').text();
  const crumbText = $('.breadcrumb,.crumb,.weizhi,.location,.nav,.current').text();
  const extraHits = collectKeywordHits(titleText + ' ' + crumbText);
  for (const k of extraHits.strongHits) {
    if (!strongHits.includes(k)) strongHits.push(k);
  }
  for (const k of extraHits.weakHits) {
    if (!weakHits.includes(k)) weakHits.push(k);
  }

  let score = 0;
  if (dateCount >= 5) score += Math.min(dateCount, 30) * 0.3;
  if (linkCount >= 10) score += Math.min(linkCount, 80) * 0.05;
  score += strongHits.length * 8;
  score += weakHits.length * 1.5;

  const lowerUrl = (url || '').toLowerCase();
  const pageTitle = $('title').text();
  for (const k of NEGATIVE_WORDS) {
    if (lowerUrl.includes(k) || pageTitle.includes(k)) {
      score -= 25;
    }
  }

  if (dateCount < 5 || linkCount < 10 || strongHits.length === 0) {
    score -= 20;
  }

  return { score, dateCount, linkCount, strongHits, weakHits };
}

async function verifyCandidate(url, deadline) {
  try {
    const remaining = getRemainingTime(deadline, FETCH_TIMEOUT_MS);
    if (remaining <= 0) {
      return { url, score: -1, dateCount: 0, linkCount: 0, strongHits: [], weakHits: [], error: 'budget' };
    }
    const html = await fetchHtml(url, remaining, deadline);
    const $ = cheerio.load(html);
    const { score, dateCount, linkCount, strongHits, weakHits } = scoreListPage($, url);
    return { url, score, dateCount, linkCount, strongHits, weakHits };
  } catch (e) {
    return { url, score: -1, dateCount: 0, linkCount: 0, strongHits: [], weakHits: [], error: e.message };
  }
}

async function runChecksWithLimit(items, fn, deadline) {
  const results = new Array(items.length);
  let index = 0;
  const workers = [];
  const workerCount = Math.min(MAX_CONCURRENT_CHECKS, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        while (true) {
          if (deadline && Date.now() >= deadline) break;
          const current = index;
          if (current >= items.length) break;
          index += 1;
          const item = items[current];
          results[current] = await fn(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

function collectSecondaryStarts(origin, $, originUrl) {
  const result = new Map();
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text) return;
    let u;
    try {
      u = new URL(href, origin);
    } catch (e) {
      return;
    }
    if (u.hostname !== originUrl.hostname && !u.hostname.endsWith('.' + originUrl.hostname)) return;
    if (u.pathname.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|jpg|png)$/i)) return;
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    const t = text.trim().toLowerCase();
    let matched = false;
    if (pathname.includes('/xxgk/') || pathname.includes('/gk/') || pathname.includes('/xxgkxx/') || t.includes('信息公开')) {
      matched = true;
    }
    if (host.startsWith('jwc.') || host.startsWith('jw.') || pathname.includes('jwc') || pathname.includes('jw') || t.includes('教务') || t.includes('本科教学')) {
      matched = true;
    }
    if (host.startsWith('yjs.') || host.startsWith('gs.') || pathname.includes('yjs') || pathname.includes('gs') || pathname.includes('graduate') || t.includes('研究生')) {
      matched = true;
    }
    if (host.startsWith('zsb.') || host.startsWith('bkzs.') || pathname.includes('zsb') || pathname.includes('bkzs') || pathname.includes('admission') || t.includes('招生')) {
      matched = true;
    }
    if (host.startsWith('zbcg.') || host.startsWith('zbb.') || pathname.includes('zbcg') || pathname.includes('zbb') || pathname.includes('tender') || pathname.includes('cg') || t.includes('招标') || t.includes('采购')) {
      matched = true;
    }
    if (host.startsWith('rsc.') || host.startsWith('hr.') || pathname.includes('rsc') || pathname.includes('hr') || t.includes('人事')) {
      matched = true;
    }
    if (!matched) return;
    const full = u.href;
    if (!result.has(full)) {
      result.set(full, { url: full, text });
    }
  });
  return Array.from(result.values());
}

function collectListCandidatesFromPage(origin, pageUrl, $, bias) {
  const originUrl = new URL(origin);
  const candidates = new Map();
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text) return;
    let u;
    try {
      u = new URL(href, pageUrl);
    } catch (e) {
      return;
    }
    if (u.hostname !== originUrl.hostname && !u.hostname.endsWith('.' + originUrl.hostname)) return;
    if (u.pathname.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|jpg|png)$/i)) return;
    const s = scoreLinkText(text) + (bias || 0);
    if (s <= 0) return;
    const full = u.href;
    const prev = candidates.get(full);
    if (!prev || prev.score < s) {
      candidates.set(full, { url: full, text, score: s });
    }
  });
  return Array.from(candidates.values());
}

async function discoverFromHomePage(origin, deadline) {
  try {
    const remaining = getRemainingTime(deadline, FETCH_TIMEOUT_MS);
    if (remaining <= 0) return null;
    const html = await fetchHtml(origin, remaining, deadline);
    const $ = cheerio.load(html);
    const originUrl = new URL(origin);
    const secondaryStarts = collectSecondaryStarts(origin, $, originUrl);
    const baseCandidates = collectListCandidatesFromPage(origin, origin, $, 0);
    const allCandidatesMap = new Map();
    for (const c of baseCandidates) {
      allCandidatesMap.set(c.url, c);
    }
    const limitedSecondary = secondaryStarts.slice(0, 8);
    for (const s of limitedSecondary) {
      if (deadline && Date.now() >= deadline) break;
      const rem = getRemainingTime(deadline, FETCH_TIMEOUT_MS);
      if (rem <= 0) break;
      let html2;
      try {
        html2 = await fetchHtml(s.url, rem, deadline);
      } catch (e) {
        continue;
      }
      const $2 = cheerio.load(html2);
      const subCandidates = collectListCandidatesFromPage(origin, s.url, $2, 5);
      for (const c of subCandidates) {
        const prev = allCandidatesMap.get(c.url);
        if (!prev || prev.score < c.score) {
          allCandidatesMap.set(c.url, c);
        }
      }
    }
    const allCandidates = Array.from(allCandidatesMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    if (allCandidates.length === 0) {
      return { url: null, candidates: [] };
    }
    const results = await runChecksWithLimit(
      allCandidates,
      item => verifyCandidate(item.url, deadline).then(r => ({ ...r, text: item.text, initialScore: item.score })),
      deadline,
    );
    const valid = results.filter(r => {
      if (!r || r.score <= 0) return false;
      if (r.dateCount < 5) return false;
      if (r.linkCount < 10) return false;
      if (!r.strongHits || r.strongHits.length === 0) return false;
      return true;
    });
    valid.sort((a, b) => b.score - a.score);
    const candidates = results
      .filter(r => r && r.url)
      .sort((a, b) => b.score - a.score)
      .map(c => ({
        url: c.url,
        score: c.score,
        dateCount: c.dateCount,
        linkCount: c.linkCount,
        strongHits: c.strongHits,
        weakHits: c.weakHits,
      }));
    if (valid.length > 0) {
      const best = valid[0];
      return {
        url: best.url,
        confidence: Math.min(1, best.score / 12),
        note: `home_extended`,
        candidates,
      };
    }
    return {
      url: null,
      confidence: 0,
      note: 'home_no_valid',
      candidates,
    };
  } catch (e) {
    if (e && e.isTimeout) throw e;
    return null;
  }
}

async function probeCommonPaths(origin, deadline) {
  const paths = [
    '/tzgg/',
    '/tzgg/index.htm',
    '/notice/',
    '/notice/index.htm',
    '/xwgg/',
    '/gg/',
    '/info/1001/index.htm',
    '/xxgk/',
  ];
  const urls = [];
  for (const p of paths) {
    let u;
    try {
      u = new URL(p, origin).href;
    } catch (e) {
      continue;
    }
    urls.push({ url: u, path: p });
  }
  if (urls.length === 0) return null;
  const results = await runChecksWithLimit(
    urls,
    item => verifyCandidate(item.url, deadline).then(r => ({ ...r, path: item.path })),
    deadline,
  );
  const valid = results.filter(r => r && r.score > 3 && r.dateCount >= 5 && r.linkCount >= 10 && r.strongHits && r.strongHits.length > 0);
  valid.sort((a, b) => b.score - a.score);
  const candidates = results
    .filter(r => r && r.url)
    .sort((a, b) => b.score - a.score)
    .map(c => ({
      url: c.url,
      score: c.score,
      dateCount: c.dateCount,
      linkCount: c.linkCount,
      strongHits: c.strongHits,
      weakHits: c.weakHits,
    }));
  if (valid.length > 0) {
    const best = valid[0];
    return {
      url: best.url,
      confidence: Math.min(1, best.score / 12),
      note: `path_probe`,
      candidates,
    };
  }
  return {
    url: null,
    confidence: 0,
    note: 'path_no_valid',
    candidates,
  };
}

async function checkSitemap(origin, deadline) {
  let sitemapUrl;
  try {
    sitemapUrl = new URL('/sitemap.xml', origin).href;
  } catch (e) {
    return null;
  }
  try {
    const remaining = getRemainingTime(deadline, FETCH_TIMEOUT_MS);
    if (remaining <= 0) return null;
    const html = await fetchHtml(sitemapUrl, remaining, deadline);
    const $ = cheerio.load(html, { xmlMode: true });
    const urls = [];
    $('url > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc) urls.push(loc);
    });
    if (urls.length === 0) {
      const matches = html.match(/https?:\/\/[^<\s"]+/g) || [];
      for (const u of matches) urls.push(u);
    }
    const keywords = ['tzgg', 'notice', 'gg', 'xwgg', 'xxgk'];
    const candidatesRaw = urls
      .filter(u => {
        const lower = u.toLowerCase();
        return keywords.some(k => lower.includes(k));
      })
      .slice(0, 20);
    if (candidatesRaw.length === 0) {
      return { url: null, confidence: 0, note: 'sitemap_empty', candidates: [] };
    }
    const results = await runChecksWithLimit(candidatesRaw, u => verifyCandidate(u, deadline), deadline);
    const valid = results.filter(r => r && r.score > 3 && r.dateCount >= 5 && r.linkCount >= 10 && r.strongHits && r.strongHits.length > 0);
    valid.sort((a, b) => b.score - a.score);
    const candidates = results
      .filter(r => r && r.url)
      .sort((a, b) => b.score - a.score)
      .map(c => ({
        url: c.url,
        score: c.score,
        dateCount: c.dateCount,
        linkCount: c.linkCount,
        strongHits: c.strongHits,
        weakHits: c.weakHits,
      }));
    if (valid.length > 0) {
      const best = valid[0];
      return {
        url: best.url,
        confidence: Math.min(1, best.score / 12),
        note: `sitemap`,
        candidates,
      };
    }
    return {
      url: null,
      confidence: 0,
      note: 'sitemap_no_valid',
      candidates,
    };
  } catch (e) {
    if (e && e.isTimeout) throw e;
    return null;
  }
}

async function findListPage(origin, deadline) {
  const homeRes = await discoverFromHomePage(origin, deadline);
  if (homeRes && homeRes.url) return homeRes;
  const pathRes = await probeCommonPaths(origin, deadline);
  if (pathRes && pathRes.url) return pathRes;
  const sitemapRes = await checkSitemap(origin, deadline);
  if (sitemapRes && sitemapRes.url) return sitemapRes;
  const candidates =
    (homeRes && homeRes.candidates) ||
    (pathRes && pathRes.candidates) ||
    (sitemapRes && sitemapRes.candidates) ||
    [];
  return {
    url: null,
    confidence: 0,
    note: 'list_not_found',
    candidates,
  };
}

function buildCrawlConfig(listUrl) {
  let detailPattern = '';
  try {
    const u = new URL(listUrl);
    const pathName = u.pathname || '/';
    const lastSlash = pathName.lastIndexOf('/');
    const dir = lastSlash >= 0 ? pathName.slice(0, lastSlash + 1) : '/';
    const escapedDir = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    detailPattern = escapedDir + '.*\\.htm';
  } catch (e) {
    detailPattern = '.*\\.htm';
  }
  return JSON.stringify({
    listUrls: [listUrl],
    detailPattern,
    selectors: {},
  });
}

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function writeCsv(filePath, headers, rows) {
  const lines = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    const values = headers.map(key => toCsvValue(row[key]));
    lines.push(values.join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const startArg = args.find(arg => arg.startsWith('--start='));
  const onlyDomainsArg = args.find(arg => arg.startsWith('--onlyDomains='));

  const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
  const START = startArg ? parseInt(startArg.split('=')[1]) : 0;
  const ONLY_DOMAINS = onlyDomainsArg ? onlyDomainsArg.split('=')[1] === 'true' : false;

  console.log(`Config: LIMIT=${LIMIT}, START=${START}, ONLY_DOMAINS=${ONLY_DOMAINS}`);

  const universities = await loadUniversities();
  const domainLookup = await buildDomainLookup();
  const aliasMap = buildAliasMap();
  console.log(`Total universities from MOE lists (merged): ${universities.length}`);
  const rootDir = path.join(__dirname, '..');
  const sourcesCsvPath = path.join(rootDir, 'cn985211_sources.csv');
  const sourcesJsonPath = path.join(rootDir, 'cn985211_sources.json');
  const missingCsvPath = path.join(rootDir, 'missing.csv');

  const sources = [];
  const missing = [];
  let domainSuccess = 0;
  let listSuccess = 0;
  const reasonCounter = {};

  const targets = universities.slice(START, LIMIT === Infinity ? undefined : START + LIMIT);
  console.log(`Processing ${targets.length} universities (from index ${START})...`);

  for (const uni of targets) {
    const startTime = Date.now();
    const deadline = startTime + PER_SCHOOL_BUDGET_MS;
    console.log('\n==========');
    console.log(`学校: ${uni.name} 标签: ${Array.isArray(uni.tags) ? uni.tags.join('/') : ''}`);

    const domainInfo = resolveDomainForUniversity(uni.name, domainLookup, aliasMap);
    if (!domainInfo || !domainInfo.host) {
      const reason = 'domain_not_found';
      missing.push({
        name: uni.name,
        tags: Array.isArray(uni.tags) ? uni.tags.join('/') : '',
        reason,
      });
      reasonCounter[reason] = (reasonCounter[reason] || 0) + 1;
      console.log('域名: 未找到');
      continue;
    }

    const origin = 'https://' + domainInfo.host;
    uni.domain = origin;
    uni.domainSource = domainInfo.source;
    uni.notes = (uni.notes || '') + '[domain:' + (domainInfo.source || '') + '] ' + (domainInfo.note || '');
    domainSuccess += 1;

    console.log('域名: ' + uni.domain + ' 来源: ' + (uni.domainSource || '') + ' 方式: ' + domainInfo.note);

    let finalUrl = origin + '/';
    let finalConfidence = 0;

    if (!ONLY_DOMAINS) {
      try {
        const listInfo = await findListPage(origin, deadline);
        
        console.log('列表页候选 (Top 3):');
        if (listInfo && listInfo.candidates) {
          listInfo.candidates.slice(0, 3).forEach(c => {
            const hits =
              c.strongHits && c.strongHits.length > 0
                ? c.strongHits.join('/')
                : c.weakHits && c.weakHits.length > 0
                ? c.weakHits.join('/')
                : '';
            console.log(
              '  - ' +
                c.url +
                ' [score=' +
                (typeof c.score === 'number' ? c.score.toFixed(1) : 'n/a') +
                ', dates=' +
                (c.dateCount != null ? c.dateCount : 'n/a') +
                ', links=' +
                (c.linkCount != null ? c.linkCount : 'n/a') +
                ', hits=' +
                hits +
                ']',
            );
          });
        }

        if (listInfo && listInfo.url) {
          uni.listUrl = listInfo.url;
          uni.confidence = listInfo.confidence;
          uni.notes = (uni.notes || '') + ' [' + listInfo.note + ']';
          listSuccess += 1;
          finalUrl = listInfo.url;
          finalConfidence = listInfo.confidence;
          console.log('最终列表页: ' + uni.listUrl);
          console.log('选中原因: ' + listInfo.note);
        } else {
          // If list not found, add to missing but also save best guesses in notes
          const reason = 'list_not_found';
          const notes =
            listInfo && Array.isArray(listInfo.candidates)
              ? listInfo.candidates
                  .slice(0, 3)
                  .map(c => {
                    const hits =
                      c.strongHits && c.strongHits.length > 0
                        ? c.strongHits.join('/')
                        : c.weakHits && c.weakHits.length > 0
                        ? c.weakHits.join('/')
                        : '';
                    return (
                      c.url +
                      ' [score=' +
                      (typeof c.score === 'number' ? c.score.toFixed(1) : 'n/a') +
                      ', dates=' +
                      (c.dateCount != null ? c.dateCount : 'n/a') +
                      ', links=' +
                      (c.linkCount != null ? c.linkCount : 'n/a') +
                      ', hits=' +
                      hits +
                      ']'
                    );
                  })
                  .join(' | ')
              : '';
          missing.push({
            name: uni.name,
            tags: Array.isArray(uni.tags) ? uni.tags.join('/') : '',
            reason,
            notes,
          });
          reasonCounter[reason] = (reasonCounter[reason] || 0) + 1;
          
          uni.notes = (uni.notes || '') + ' [candidates:' + (listInfo?.candidates?.slice(0,3).join('|') || 'none') + ']';
          console.log('最终列表页: 未找到');
          // Don't add to sources if not found
        }
      } catch (e) {
        const reason = e && e.isTimeout ? 'timeout' : 'error';
        const notes =
          e && e.message
            ? e.message
            : '';
        missing.push({
          name: uni.name,
          tags: Array.isArray(uni.tags) ? uni.tags.join('/') : '',
          reason,
          notes,
        });
        reasonCounter[reason] = (reasonCounter[reason] || 0) + 1;
        console.log(`列表页探测失败: ${reason} (${e.message})`);
      }
    } else {
      console.log('列表页探测: 已跳过 (--onlyDomains=true)');
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`耗时: ${duration.toFixed(1)}s`);

    // Only add to sources if we found a valid list URL
    if (uni.listUrl) {
      const crawlConfig = buildCrawlConfig(uni.listUrl);
      const is985 = Array.isArray(uni.tags) && uni.tags.includes('985');
      const is211 = Array.isArray(uni.tags) && uni.tags.includes('211');
      const nameSuffix = is985 ? '985' : is211 ? '211' : '';
      const sourceName = uni.name + ' 通知公告' + (nameSuffix ? ' ' + nameSuffix : '');

      sources.push({
        name: sourceName,
        type: 'HTML',
        url: uni.listUrl,
        regionTag: 'CN',
        categoryTag: '通知公告',
        priority: 3,
        isActive: false,
        fetchIntervalMinutes: 60,
        crawlConfig,
        confidence: finalConfidence,
        domainSource: uni.domainSource,
        notes: uni.notes,
      });
    }
  }

  // Write output
  writeCsv(
    sourcesCsvPath,
    [
      'name', 'type', 'url', 'regionTag', 'categoryTag', 'priority', 
      'isActive', 'fetchIntervalMinutes', 'crawlConfig', 'confidence', 
      'domainSource', 'notes'
    ],
    sources
  );
  
  fs.writeFileSync(sourcesJsonPath, JSON.stringify({ sources }, null, 2), 'utf8');

  writeCsv(missingCsvPath, ['name', 'tags', 'reason', 'notes'], missing);

  console.log('\n========== 汇总统计 ==========');
  console.log(`本次处理: ${targets.length}`);
  console.log(`成功找到官网域名数: ${domainSuccess}`);
  console.log(`成功找到列表页数: ${listSuccess}`);
  console.log('失败原因 Top5:');
  const reasonEntries = Object.entries(reasonCounter).sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < Math.min(5, reasonEntries.length); i++) {
    const [reason, count] = reasonEntries[i];
    console.log(`  - ${reason}: ${count}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
