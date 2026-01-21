
import { execFileSync } from 'node:child_process';

console.log("Checking environment for curl support...");

try {
  // Check if curl is available
  const versionOutput = execFileSync('curl', ['--version'], { encoding: 'utf-8' });
  console.log("Curl found:");
  console.log(versionOutput.split('\n')[0]);
  console.log("Environment check passed.");
} catch (error: any) {
  console.error("Environment check failed:", error.message);
  process.exit(1);
}
