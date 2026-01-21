
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const execFileAsync = promisify(execFile);

interface CurlResult {
  status: number;
  finalUrl: string;
  html: string;
}

// Simple concurrency limiter
const MAX_CONCURRENT_CURLS = 3;
let activeCurls = 0;
const queue: (() => void)[] = [];

async function acquireToken(): Promise<void> {
  if (activeCurls < MAX_CONCURRENT_CURLS) {
    activeCurls++;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
  });
}

function releaseToken() {
  activeCurls--;
  if (queue.length > 0) {
    const next = queue.shift();
    if (next) {
      activeCurls++; // Immediately take the slot
      next();
    }
  }
}

export async function fetchHtmlWithCurl(
  url: string, 
  headers?: Record<string, string>,
  timeoutMs: number = 20000,
  extraArgs: string[] = []
): Promise<CurlResult> {
  await acquireToken();
  
  // Generate a temp file path
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpPath = path.join(os.tmpdir(), `curl_fetch_${tmpId}.html`);

  const args = [
    '-sS', // Silent mode but show errors
    '-L', // Follow redirects
    '--compressed', // Handle gzip/deflate
    '-o', tmpPath, // Output to file
    '-w', '%{http_code} %{url_effective}', // Write status and final URL to stdout
    '--max-time', (timeoutMs / 1000).toString(), // Curl internal timeout
    ...extraArgs,
  ];

  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }

  // Add URL at the end
  args.push(url);

  try {
    // Add process-level timeout (kill signal)
    const { stdout } = await execFileAsync('curl', args, { 
        encoding: 'utf-8',
        timeout: timeoutMs + 1000 // Give curl a chance to timeout gracefully first
    });
    
    // Parse stdout: "200 https://final.url/"
    const parts = stdout.trim().split(' ');
    const statusStr = parts[0];
    const finalUrl = parts.slice(1).join(' ') || url;
    const status = parseInt(statusStr, 10);

    let html = '';
    if (fs.existsSync(tmpPath)) {
      html = fs.readFileSync(tmpPath, 'utf-8');
      fs.unlinkSync(tmpPath); // Clean up
    }

    return { status, finalUrl, html };

  } catch (e: any) {
    // Clean up if exists
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    
    // Check if it's a curl exit code error
    if (e.code && typeof e.code === 'number') {
        throw new Error(`Curl process exited with code ${e.code}: ${e.message}`);
    }
    throw e;
  } finally {
      releaseToken();
  }
}
