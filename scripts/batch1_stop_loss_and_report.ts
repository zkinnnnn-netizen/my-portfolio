import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Fetch Batch 1 sources (identified by fetchIntervalMinutes=120)
  const sources = await prisma.source.findMany({
    where: { isActive: true, fetchIntervalMinutes: 120 },
  });

  console.log("=== Step 5 & 6: Validation and Report ===");
  console.log("Batch 1 Sources (fetchIntervalMinutes=120): " + sources.length);

  const passed: any[] = [];
  const stopped: any[] = [];
  const pendingFix: any[] = [];

  const nowIso = new Date().toISOString();

  console.log("\n| Source Name | Type | Fetched | Upserted | Errors | Status |");
  console.log("|---|---|---|---|---|---|");

  for (const s of sources) {
    let stats: any = { fetched: 0, errors: 0, upserted: 0 };
    try {
      if (s.lastRunStats) stats = JSON.parse(s.lastRunStats);
    } catch (e) {}

    let status = "PASS";
    
    // Check Errors
    if (stats.errors > 0) {
        status = "FAIL (Errors)";
        // Stop loss: Disable the source
        const reason = `AutoDisabled:DRYRUN_ERRORS at ${nowIso} reason=Errors>0 in batch 1 dry-run`;
        await prisma.source.update({
            where: { id: s.id },
            data: {
                isActive: false,
                lastError: reason
            }
        });
        stopped.push({ name: s.name, reason });
    } else if (stats.fetched === 0) {
        status = "PENDING_FIX (Fetched=0)";
        // Mark for fix pool (do not disable yet unless explicitly asked, instructions say: "Fetched=0: mark as pending fix")
        // "如果是明显 JS 模板页/403，则也可禁用". For now, just mark.
        pendingFix.push({ name: s.name, reason: "Fetched=0" });
    } else {
        passed.push(s.name);
    }

    console.log(`| ${s.name} | ${s.type} | ${stats.fetched} | ${stats.upserted} | ${stats.errors} | ${status} |`);
  }

  console.log("\n=== Final Report ===");
  console.log(`Total Batch 1 Sources: ${sources.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Stopped (Auto-Disabled): ${stopped.length}`);
  if (stopped.length > 0) {
      stopped.forEach(x => console.log(`  - ${x.name}: ${x.reason}`));
  }
  console.log(`Pending Fix (Fetched=0): ${pendingFix.length}`);
  if (pendingFix.length > 0) {
      pendingFix.forEach(x => console.log(`  - ${x.name}`));
  }

  console.log("\nNext Batch Recommendation: Proceed with next 8 sources if pass rate > 80%.");
}

main()
  .catch(e => {
      console.error(e);
      process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
