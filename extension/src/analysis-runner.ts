/**
 * analysis-runner.ts
 *
 * Spawns out/worker.js as a Node.js child process to run the pair-analysis
 * pipeline off the extension host main thread.
 *
 * Queue semantics (per teammate email):
 *   - At most one worker running per email at a time.
 *   - If a new snapshot arrives while a worker is in-flight for that email,
 *     kill the stale worker and start a fresh one immediately.
 *   - Hard timeout: 30 seconds. Kill the worker if exceeded.
 *
 * IPC:
 *   stdin  ← AnalysisJobRequest (JSON, single write)
 *   stdout → Finding[]           (JSON, single line)
 *   stderr → logged to OutputChannel, never thrown
 */

import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import type { AnalysisJobRequest, Finding } from '@interlens/core';

/** Absolute path to the bundled worker script. */
const WORKER_PATH = path.join(__dirname, '..', 'out', 'worker.js');

/** Timeout before a worker is forcibly killed (ms). */
const WORKER_TIMEOUT_MS = 30_000;

export type FindingsCallback = (
  findings: Finding[],
  teammateEmail: string,
) => void;

interface RunningJob {
  process: ChildProcess;
  timer: ReturnType<typeof setTimeout>;
}

export class AnalysisRunner {
  private readonly channel: vscode.OutputChannel;
  private readonly onFindings: FindingsCallback;
  /** One in-flight job per teammate email. */
  private readonly jobs = new Map<string, RunningJob>();

  constructor(
    channel: vscode.OutputChannel,
    onFindings: FindingsCallback,
  ) {
    this.channel = channel;
    this.onFindings = onFindings;
  }

  /**
   * Schedule an analysis job for the given request.
   *
   * If a job is already running for the same teammate, it is killed before
   * the new one starts.
   */
  run(req: AnalysisJobRequest): void {
    const email = req.theirSnapshot.userEmail;

    // Kill stale job for this teammate, if any
    this.cancel(email);

    const child = spawn(process.execPath, [WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      this.channel.appendLine(
        `[InterLens] Worker for ${email} timed out after ${WORKER_TIMEOUT_MS}ms — killing.`,
      );
      child.kill();
      this.jobs.delete(email);
    }, WORKER_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      this.jobs.delete(email);

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (stderr) {
        this.channel.appendLine(`[InterLens] Worker stderr (${email}): ${stderr}`);
      }

      if (code !== 0) {
        this.channel.appendLine(
          `[InterLens] Worker exited with code ${code ?? '?'} for ${email}.`,
        );
        return;
      }

      const raw = Buffer.concat(stdoutChunks).toString('utf8').trim();
      let findings: Finding[];
      try {
        findings = JSON.parse(raw) as Finding[];
      } catch {
        this.channel.appendLine(
          `[InterLens] Could not parse worker output for ${email}: ${raw.slice(0, 200)}`,
        );
        return;
      }

      this.onFindings(findings, email);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      this.jobs.delete(email);
      this.channel.appendLine(
        `[InterLens] Worker spawn error for ${email}: ${String(err)}`,
      );
    });

    // Send the request and close stdin so the worker knows to start
    const payload = JSON.stringify(req) + '\n';
    child.stdin?.write(payload, 'utf8', () => {
      child.stdin?.end();
    });

    this.jobs.set(email, { process: child, timer });
    this.channel.appendLine(`[InterLens] Worker started for ${email}.`);
  }

  /** Cancel an in-flight job for a specific teammate (if any). */
  cancel(email: string): void {
    const job = this.jobs.get(email);
    if (!job) return;
    clearTimeout(job.timer);
    job.process.kill();
    this.jobs.delete(email);
    this.channel.appendLine(`[InterLens] Cancelled stale worker for ${email}.`);
  }

  /** Cancel all in-flight jobs (called on deactivate). */
  dispose(): void {
    for (const email of [...this.jobs.keys()]) {
      this.cancel(email);
    }
  }
}
