// extension.ts — VS Code extension entry point
// Sub-Task 2: adds SnapshotProducer and GitPollingNotifier wiring.
// Sub-Tasks 5–8 will add diagnostics, status bar, tree view, and LLM commands.

import * as vscode from 'vscode';
import { GitPollingNotifier } from '@interlens/core';
import { SnapshotProducer } from './snapshot-producer';

let producer: SnapshotProducer | null = null;
let notifier: GitPollingNotifier | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('InterLens');
  context.subscriptions.push(channel);
  channel.appendLine('InterLens activating…');

  const config = vscode.workspace.getConfiguration('interlens');
  const debounceMs = config.get<number>('sync.snapshotDebounceMs') ?? 5000;
  const fetchIntervalSec = config.get<number>('sync.fetchIntervalSec') ?? 5;
  const displayName = config.get<string>('user.displayName') ?? '';

  // Snapshot producer: pushes working-tree snapshots on file save
  producer = new SnapshotProducer({
    debounceMs,
    displayName,
    userEmail: '', // resolved from git config at push time
    onError: (err) => {
      channel.appendLine(`[InterLens] snapshot push error: ${String(err)}`);
    },
  });
  producer.activate(context);

  // Determine repo root from first workspace folder
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    channel.appendLine('[InterLens] No workspace folder open — polling disabled.');
    return;
  }

  // Get own email from git config (best-effort; errors are non-fatal)
  let ownEmail = '';
  // We'll resolve it lazily in the notifier options once the first poll fires.
  // For now, read from git synchronously via child_process — only once at startup.
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    ownEmail = execFileSync('git', ['config', 'user.email'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    channel.appendLine('[InterLens] Could not read git user.email — own-ref filtering disabled.');
  }

  // GitPollingNotifier: detects teammate snapshot changes
  notifier = new GitPollingNotifier({
    repoRoot: workspaceRoot,
    ownEmail,
    fetchIntervalSec,
    onFocus: (trigger) => {
      const disposable = vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) trigger();
      });
      context.subscriptions.push(disposable);
      return () => disposable.dispose();
    },
    onSyncError: (inError) => {
      if (inError) {
        channel.appendLine('[InterLens] Sync error — entering backoff.');
      } else {
        channel.appendLine('[InterLens] Sync recovered.');
      }
    },
  });

  notifier.start((_changes) => {
    // Sub-Task 5 will dispatch changes to the analysis runner.
    channel.appendLine(`[InterLens] Teammate snapshot changed (${_changes.length} ref(s)).`);
  });

  channel.appendLine('InterLens activated.');
}

export function deactivate(): void {
  producer?.dispose();
  notifier?.stop();
  producer = null;
  notifier = null;
}
