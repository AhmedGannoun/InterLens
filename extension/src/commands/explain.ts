/**
 * commands/explain.ts — interlens.explain command handler.
 *
 * Flow:
 * 1. Get the active finding from the diagnostic passed as argument
 *    (or pick from findingsByEmail if invoked from tree view).
 * 2. Build ExplainInput (finding + diff hunks trimmed to 60 lines each).
 * 3. Check cache — return instantly on hit.
 * 4. Create streaming webview panel.
 * 5. Call the configured provider and stream tokens into the panel.
 * 6. Store result in cache on success.
 */

import * as vscode from 'vscode';
import type { Finding, ExplainInput } from '@interlens/core';
import { createProvider, buildCacheKey, getFromCache, setInCache } from '@interlens/core';
import type { LLMProviderId } from '@interlens/core';
import { getApiKey, redactKey } from '../secrets';
import { openExplainPanel } from '../webview/explain-panel';

/** Max diff hunk lines sent to the LLM. */
const MAX_HUNK_LINES = 60;

/** Trim a diff hunk to at most MAX_HUNK_LINES lines. */
function trimHunk(hunk: string): string {
  const lines = hunk.split('\n');
  if (lines.length <= MAX_HUNK_LINES) return hunk;
  return lines.slice(0, MAX_HUNK_LINES).join('\n') + '\n[…truncated]';
}

/**
 * Build a minimal diff hunk for a file against HEAD using git diff.
 * Returns an empty string if git is unavailable or the file has no diff.
 */
async function getDiffHunk(
  repoRoot: string,
  filePath: string,
  commitSha: string,
): Promise<string> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['diff', commitSha, '--', filePath], {
      cwd: repoRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
    return trimHunk(stdout);
  } catch {
    return '';
  }
}

/**
 * Register the interlens.explain command.
 *
 * @param context VS Code extension context (for secrets + subscriptions).
 * @param repoRoot Workspace root used for git diff.
 * @param findingsByEmail In-memory findings map maintained by extension.ts.
 * @param channel Output channel for diagnostic logging.
 */
export function registerExplainCommand(
  context: vscode.ExtensionContext,
  repoRoot: string,
  findingsByEmail: Map<string, Finding[]>,
  channel: vscode.OutputChannel,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'interlens.explain',
    async (finding?: Finding) => {
      // If no finding was passed, let the user pick from all available findings
      if (!finding) {
        const all = [...findingsByEmail.values()].flat();
        if (all.length === 0) {
          await vscode.window.showInformationMessage('InterLens: No findings to explain.');
          return;
        }
        const items = all.map((f) => ({
          label: `$(warning) ${f.description}`,
          description: `${f.myFile} ↔ ${f.theirFile}`,
          finding: f,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a finding to explain',
        });
        if (!picked) return;
        finding = picked.finding;
      }

      // Check cache first
      const cacheKey = buildCacheKey(finding);
      const cached = getFromCache(cacheKey);
      if (cached) {
        channel.appendLine(`[InterLens] Explain cache hit for ${finding.id}`);
        const panel = openExplainPanel(context, finding);
        panel.postToken(cached.markdown);
        panel.postDone();
        return;
      }

      // Build LLM provider from settings
      const cfg = vscode.workspace.getConfiguration('interlens.llm');
      const provider = (cfg.get<string>('provider') ?? 'ibm-bob') as LLMProviderId;
      const baseUrl   = cfg.get<string>('baseUrl') ?? '';
      const model     = cfg.get<string>('model') ?? '';
      const teamId    = cfg.get<string>('bobTeamId') ?? '';
      const timeoutMs = cfg.get<number>('timeoutMs') ?? 20_000;
      const apiKey    = (await getApiKey(context.secrets, provider)) ?? '';

      // First-run check for ibm-bob with no key
      if (provider === 'ibm-bob' && !apiKey && baseUrl) {
        const choice = await vscode.window.showInformationMessage(
          'InterLens: Add your IBM Bob API key to enable explanations.',
          'Add IBM Bob key',
          'Use another provider',
        );
        if (choice === 'Add IBM Bob key') {
          await vscode.commands.executeCommand('interlens.setApiKey');
          return;
        } else if (choice === 'Use another provider') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'interlens.llm',
          );
          return;
        }
        return;
      }

      const llmProvider = createProvider({
        provider,
        apiKey,
        baseUrl,
        model,
        teamId,
        timeoutMs,
      });

      // Build diff hunks
      const myHunk = await getDiffHunk(repoRoot, finding.myFile, finding.mySnapshotHash);
      const theirHunk = await getDiffHunk(repoRoot, finding.theirFile, finding.theirSnapshotHash);

      const input: ExplainInput = {
        finding,
        myDiffHunk: myHunk,
        theirDiffHunk: theirHunk,
      };

      // Open streaming panel
      const panel = openExplainPanel(context, finding);

      try {
        const result = await llmProvider.explain(input, panel.signal);
        panel.postToken(result.markdown);
        panel.postDone();
        // Store in cache
        setInCache(cacheKey, result);
        channel.appendLine(`[InterLens] Explain completed for ${finding.id} (provider: ${provider})`);
      } catch (err) {
        const errStr = redactKey(String(err), apiKey);
        channel.appendLine(`[InterLens] Explain error: ${errStr}`);
        panel.postError(errStr);
      }
    },
  );
}
