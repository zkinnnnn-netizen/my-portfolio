
import { Crawler } from '../lib/crawler';

// Mock global fetch to inspect headers
const originalFetch = global.fetch;

// @ts-ignore
global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  console.log('--- Outgoing Fetch Request ---');
  console.log('URL:', input.toString());
  console.log('Headers:', JSON.stringify(init?.headers, null, 2));
  
  // Return a mock 412 to simulate reality, or just exit.
  // We just want to see headers.
  return {
    status: 412,
    ok: false,
    text: async () => 'mock 412',
    headers: new Headers(),
  } as unknown as Response;
};

async function run() {
  console.log('Starting diagnostic run...');
  const crawler = new Crawler();
  const url = 'https://zsb.nankai.edu.cn/index/zhaosheng.html';
  
  // Simulate what ingest.ts does when source.etag and source.lastModified are null/undefined
  // (which they are for Nankai since fetched=0)
  await crawler.fetch(url, null, null);
}

run().catch(console.error);
