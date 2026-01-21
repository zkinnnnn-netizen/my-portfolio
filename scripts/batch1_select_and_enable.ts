
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Step 0: Identify disabled sources (Blacklist)
  // Query Source table where lastError contains "WAFBlocked:NKSOC_JS_CHALLENGE" OR lastError contains "DynamicSite:LIST_JS_RENDER"
  const disabledSources = await prisma.source.findMany({
    where: {
      OR: [
        { lastError: { contains: "WAFBlocked:NKSOC_JS_CHALLENGE" } },
        { lastError: { contains: "DynamicSite:LIST_JS_RENDER" } }
      ]
    },
    select: { id: true, name: true, url: true, isActive: true, lastError: true }
  });

  console.log("=== Step 0: Confirmed Disabled Sources (Blacklist) ===");
  const blacklistIds = new Set(disabledSources.map(s => s.id));
  const blacklistDomains = ['zsb.nankai.edu.cn', 'bkzs.nju.edu.cn/static/front/'];
  
  disabledSources.forEach(s => {
    console.log(`[BLACKLIST] ${s.name} (${s.url}) - isActive: ${s.isActive}`);
  });

  // Step 1: Pull all sources and build candidate pool
  const allSources = await prisma.source.findMany({
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      isActive: true,
      fetchIntervalMinutes: true,
      lastError: true,
      crawlConfig: true
    }
  });

  const candidates = allSources.filter(s => {
    // a) isActive=false
    if (s.isActive) return false;
    
    // b) lastError is null or empty
    if (s.lastError && s.lastError.trim() !== '') return false;
    
    // c) Exclude blacklist IDs and blacklist domains
    if (blacklistIds.has(s.id)) return false;
    if (blacklistDomains.some(d => s.url.includes(d))) return false;

    return true;
  });

  // Sort/Prioritize
  const rssCandidates = candidates.filter(s => s.type === 'RSS');
  const htmlCandidates = candidates.filter(s => s.type === 'HTML');

  // Helper to check for static list URL features
  const isStaticLike = (s: any) => {
    let config: any = {};
    try {
      config = JSON.parse(s.crawlConfig || '{}');
    } catch (e) { return false; }
    
    const listUrls = config.listUrls || [];
    if (!Array.isArray(listUrls) || listUrls.length === 0) return false;
    const url = listUrls[0];
    
    // Check for static keywords in the URL
    if (url.match(/(list|tzgg|index|notice)\.(htm|html|shtml)/i)) return true;
    return false;
  };

  // Sort HTML candidates: static-like first
  htmlCandidates.sort((a, b) => {
    const aStatic = isStaticLike(a);
    const bStatic = isStaticLike(b);
    if (aStatic && !bStatic) return -1;
    if (!aStatic && bStatic) return 1;
    return 0;
  });

  // Step 2: Select 8 sources
  const selected: typeof candidates = [];
  
  // 1) Up to 5 RSS sources
  const rssToTake = rssCandidates.slice(0, 5);
  selected.push(...rssToTake);

  // 2) Fill rest with HTML sources
  const remainingSlots = 8 - selected.length;
  if (remainingSlots > 0) {
    selected.push(...htmlCandidates.slice(0, remainingSlots));
  }

  console.log(`\n=== Step 2: Selected Batch 1 Sources (Total: ${selected.length}) ===`);
  selected.forEach(s => {
    let listUrl = "N/A";
    try {
        const c = JSON.parse(s.crawlConfig || '{}');
        if (c.listUrls && c.listUrls.length > 0) listUrl = c.listUrls[0];
    } catch(e) {}
    console.log(`[SELECTED] ${s.name} | Type: ${s.type} | URL: ${s.url} | ListURL: ${listUrl}`);
  });

  if (selected.length === 0) {
      console.log("No candidates found.");
      return;
  }

  // Step 3: Enable them
  console.log("\n=== Step 3: Enabling Sources ===");
  for (const s of selected) {
    // Double check lastError safety (redundant but safe)
    if (s.lastError && s.lastError.trim() !== '') {
        console.log(`[SKIP-SAFETY] ${s.name} has lastError, skipping.`);
        continue;
    }
    
    await prisma.source.update({
        where: { id: s.id },
        data: {
            isActive: true,
            fetchIntervalMinutes: 120, // 2 hours as requested
        }
    });
    console.log(`[ENABLED] ${s.name} (fetchIntervalMinutes=120)`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
