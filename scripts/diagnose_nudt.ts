
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { ingestAll } from '../lib/ingest';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const prisma = new PrismaClient();

async function main() {
  console.log('========================');
  console.log('A) 诊断「国防科技大学-通知公告」');
  console.log('========================');

  // 1) Read Source
  const sourceName = '国防科技大学-通知公告';
  const source = await prisma.source.findFirst({
    where: { name: sourceName },
  });

  if (!source) {
    console.error(`Source ${sourceName} not found`);
    return;
  }

  console.log('1) Source Info:');
  console.log(JSON.stringify({
    id: source.id,
    name: source.name,
    url: source.url,
    type: source.type,
    isActive: source.isActive,
    fetchIntervalMinutes: source.fetchIntervalMinutes,
    lastError: source.lastError,
    lastRunStats: source.lastRunStats,
    crawlConfig: source.crawlConfig ? JSON.parse(source.crawlConfig) : null,
  }, null, 2));

  // 2) Single Source Dry-Run
  console.log('\n2) Single Source Dry-Run Logs:');
  try {
    // We capture stdout/stderr if we were running as a subprocess, but here we import.
    // The ingestAll function logs to console.
    // We will just run it and let it log.
    await ingestAll({ dryRun: true, sourceName: sourceName });
  } catch (e) {
    console.error('Dry-run execution failed:', e);
  }

  // Refetch to see updated stats if any (ingestAll updates lastRunStats even in dryRun)
  const updatedSource = await prisma.source.findUnique({ where: { id: source.id } });
  if (updatedSource?.lastRunStats) {
      console.log('Updated Stats:', updatedSource.lastRunStats);
  }

  // 3) Curl Diagnosis
  console.log('\n3) Curl Diagnosis:');
  let listUrl = '';
  try {
    const config = JSON.parse(source.crawlConfig || '{}');
    if (config.listUrls && config.listUrls.length > 0) {
      listUrl = config.listUrls[0];
    }
  } catch (e) {}

  if (listUrl) {
    const tmpFile = '/tmp/nudt.html';
    const curlCmd = `curl -sS -D - -o ${tmpFile} -L "${listUrl}"`;
    console.log(`Executing: ${curlCmd}`);
    
    try {
      const { stdout, stderr } = await execPromise(curlCmd);
      // Print head of file (headers are in the file because -D - writes headers to stdout? No, -D - writes headers to stdout, -o writes body to file. Wait.
      // curl -D - -o file means headers to stdout, body to file.
      // The user asked: curl -sS -D - -o /tmp/nudt.html -L "URL" | head -n 40
      // This pipes headers to head.
      
      const curlCheckCmd = `${curlCmd} | head -n 40`;
      const { stdout: headerOutput } = await execPromise(curlCheckCmd);
      console.log('--- Curl Output (Headers) ---');
      console.log(headerOutput);

      const { stdout: wcOutput } = await execPromise(`wc -c ${tmpFile}`);
      console.log(`Body Size: ${wcOutput.trim()}`);

      const { stdout: bodyHead } = await execPromise(`sed -n '1,20p' ${tmpFile}`);
      console.log('--- Body Head (First 20 lines) ---');
      console.log(bodyHead);
      
    } catch (e: any) {
      console.error('Curl failed:', e.message);
    }
  } else {
    console.log('No listUrl found in crawlConfig');
  }

  console.log('\n4) Recommendation:');
  console.log('Based on the output above, analyze the error.');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
