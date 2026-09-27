/**
 * worker-entry.ts — Analysis child process entry point
 *
 * Reads an AnalysisJobRequest from stdin as JSON, runs the full pair analysis
 * pipeline, and writes a Finding[] to stdout as JSON.
 *
 * Errors are written to stderr and the process exits with code 1.
 */

import { runAnalysis } from './analysis';
import type { AnalysisJobRequest, Finding } from './types';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify([]) + '\n');
    return;
  }

  const req: AnalysisJobRequest = JSON.parse(raw);
  const findings: Finding[] = await runAnalysis(req);
  process.stdout.write(JSON.stringify(findings) + '\n');
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
