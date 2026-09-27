/**
 * cli.ts — Fallback demo CLI
 *
 * Usage: node out/cli.js <repoA> <repoB>
 *
 * Reads the latest snapshot from refs/interlens/<slug> in each repo,
 * runs the full pair analysis pipeline, and prints findings as JSON
 * (one per line) to stdout.
 *
 * This is the fallback demo path if the VS Code UI is broken.
 */

import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import { runAnalysis } from './analysis';
import { fetchTeammateSnapshot } from './snapshot';
import type { OwnSnapshot, AnalysisJobRequest } from './types';

const execFile = util.promisify(execFileCb);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function readLatestSnapshot(repoRoot: string): Promise<OwnSnapshot | null> {
  // List all refs/interlens/* in this repo
  let lsOutput: string;
  try {
    lsOutput = await git(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/interlens/']);
  } catch {
    return null;
  }

  const refs = lsOutput.split('\n').map((l) => l.trim()).filter(Boolean)
    // Exclude remote tracking refs (refs/interlens/remote/*)
    .filter((r) => !r.startsWith('refs/interlens/remote/'));

  if (refs.length === 0) return null;

  // Take the first (there should be one per developer)
  const ref = refs[0];
  return fetchTeammateSnapshot(repoRoot, ref);
}

async function main(): Promise<void> {
  const [repoA, repoB] = process.argv.slice(2);

  if (!repoA || !repoB) {
    process.stderr.write('Usage: node out/cli.js <repoA> <repoB>\n');
    process.exit(1);
  }

  const snapA = await readLatestSnapshot(repoA);
  if (!snapA) {
    process.stderr.write(`No snapshot found in ${repoA}. Run InterLens extension first.\n`);
    process.exit(1);
  }

  const snapB = await readLatestSnapshot(repoB);
  if (!snapB) {
    process.stderr.write(`No snapshot found in ${repoB}. Run InterLens extension first.\n`);
    process.exit(1);
  }

  // Fetch snapB's objects into repoA's object database
  try {
    const bareUrl = await git(repoA, ['remote', 'get-url', 'origin']).catch(() => '');
    if (bareUrl) {
      // Fetch from origin to ensure all objects are available in repoA
      await git(repoA, ['fetch', 'origin']).catch(() => {});
    }
  } catch {
    // Non-fatal — repoA might already have all objects
  }

  const req: AnalysisJobRequest = {
    repoRoot: repoA,
    mySnapshot: snapA,
    theirSnapshot: snapB,
    checkCommand: 'npx tsc --noEmit -p .',
    sharedTypePaths: ['shared/', 'types/', 'contracts/', 'interfaces/'],
  };

  const findings = await runAnalysis(req);

  if (findings.length === 0) {
    process.stdout.write('[]\n');
    return;
  }

  for (const finding of findings) {
    process.stdout.write(JSON.stringify(finding) + '\n');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
