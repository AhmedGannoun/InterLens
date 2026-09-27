// extension.ts — VS Code extension entry point
//
// Sub-Task 2: SnapshotProducer + GitPollingNotifier wiring.
// Sub-Task 5: AnalysisRunner, Diagnostics, StatusBar, TreeView wiring.
// Sub-Task 7: LLM commands (explain, setApiKey, clearApiKey, testConnection).

import * as vscode from 'vscode';
import { GitPollingNotifier } from '@interlens/core';
import type { TeammateSnapshotChange, Finding, TeammateSnapshot } from '@interlens/core';
import { SnapshotProducer } from './snapshot-producer';
import { AnalysisRunner } from './analysis-runner';
import { updateDiagnostics, COLLECTION_NAME } from './diagnostics';
import { InterLensStatusBar } from './status-bar';
import { TeammateTreeDataProvider } from './tree-view';
import { registerExplainCommand } from './commands/explain';
import { registerSetApiKeyCommand } from './commands/set-api-key';
import { registerClearApiKeyCommand } from './commands/clear-api-key';
import { registerTestConnectionCommand } from './commands/test-connection';

let producer: SnapshotProducer | null = null;
let notifier: GitPollingNotifier | null = null;
let runner: AnalysisRunner | null = null;
let statusBar: InterLensStatusBar | null = null;
let diagnostics: vscode.DiagnosticCollection | null = null;
let treeProvider: TeammateTreeDataProvider | null = null;

/** All findings grouped by teammate email (kept in memory for tree view). */
const findingsByEmail = new Map<string, Finding[]>();

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('InterLens');
  context.subscriptions.push(channel);
  channel.appendLine('InterLens activating…');

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------
  const config = vscode.workspace.getConfiguration('interlens');
  const debounceMs       = config.get<number>('sync.snapshotDebounceMs') ?? 5000;
  const fetchIntervalSec = config.get<number>('sync.fetchIntervalSec')   ?? 5;
  const displayName      = config.get<string>('user.displayName')         ?? '';

  // --------------------------------------------------------------------------
  // Determine workspace root
  // --------------------------------------------------------------------------
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  if (!workspaceRoot) {
    channel.appendLine('[InterLens] No workspace folder open — all features disabled.');
    return;
  }

  // --------------------------------------------------------------------------
  // Status bar (Sub-Task 5)
  // --------------------------------------------------------------------------
  statusBar = new InterLensStatusBar();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // --------------------------------------------------------------------------
  // Diagnostics collection (Sub-Task 5)
  // --------------------------------------------------------------------------
  diagnostics = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  context.subscriptions.push(diagnostics);

  // --------------------------------------------------------------------------
  // Tree view (Sub-Task 5)
  // --------------------------------------------------------------------------
  treeProvider = new TeammateTreeDataProvider(workspaceRoot);
  const treeView = vscode.window.createTreeView('interlens.teammates', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // --------------------------------------------------------------------------
  // Analysis runner (Sub-Task 5)
  // --------------------------------------------------------------------------
  runner = new AnalysisRunner(channel, (findings, email) => {
    // Store findings for this teammate
    findingsByEmail.set(email, findings);

    // Flatten all findings and rebuild the DiagnosticCollection
    const allFindings = [...findingsByEmail.values()].flat();
    updateDiagnostics(diagnostics!, allFindings, workspaceRoot);

    // Refresh tree view findings for this teammate
    treeProvider?.updateFindings(email, findings);

    // Update status bar finding count
    const totalCount = [...findingsByEmail.values()].reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    statusBar?.setState('idle', totalCount);

    channel.appendLine(
      `[InterLens] Analysis complete for ${email}: ${findings.length} finding(s).`,
    );
  });
  context.subscriptions.push({ dispose: () => runner?.dispose() });

  // --------------------------------------------------------------------------
  // Snapshot producer (Sub-Task 2)
  // --------------------------------------------------------------------------
  producer = new SnapshotProducer({
    debounceMs,
    displayName,
    userEmail: '',
    onError: (err) => {
      channel.appendLine(`[InterLens] snapshot push error: ${String(err)}`);
    },
  });
  producer.activate(context);

  // --------------------------------------------------------------------------
  // Own email from git config (best-effort, once at startup)
  // --------------------------------------------------------------------------
  let ownEmail = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('child_process') as typeof import('child_process');
    ownEmail = execFileSync('git', ['config', 'user.email'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    channel.appendLine('[InterLens] Could not read git user.email — own-ref filtering disabled.');
  }

  // --------------------------------------------------------------------------
  // GitPollingNotifier (Sub-Task 2 + Sub-Task 5 wiring)
  // --------------------------------------------------------------------------
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
        statusBar?.setState('error');
      } else {
        channel.appendLine('[InterLens] Sync recovered.');
        const total = [...findingsByEmail.values()].reduce(
          (s, a) => s + a.length, 0,
        );
        statusBar?.setState('idle', total);
      }
    },
  });

  notifier.start((changes: TeammateSnapshotChange[]) => {
    statusBar?.setState('syncing');

    for (const change of changes) {
      channel.appendLine(
        `[InterLens] Snapshot changed for ${change.userEmail} (${change.newHash.slice(0, 8)}).`,
      );

      // Read the TeammateSnapshot from the fetched commit message.
      // The GitPollingNotifier already fetched and parsed it; we reconstruct
      // it from the change object via fetchTeammateSnapshot if needed.
      // For Sub-Task 5 we dispatch an analysis job immediately.
      // The full AnalysisJobRequest requires both snapshots; the notifier
      // provides only the TeammateSnapshotChange. We need the own snapshot
      // too — use the most recently pushed one cached by SnapshotProducer.
      const mySnapshot = producer?.lastSnapshot;
      if (!mySnapshot) {
        channel.appendLine(
          `[InterLens] No own snapshot yet — skipping analysis for ${change.userEmail}.`,
        );
        statusBar?.setState('idle');
        return;
      }

      // Fetch the teammate's full snapshot from their local ref
      // (already fetched by GitPollingNotifier into refs/interlens/remote/<slug>)
      void fetchAndRunAnalysis(
        change,
        workspaceRoot,
        mySnapshot,
        channel,
        treeProvider!,
      );
    }

    // Reset to idle after dispatching; runner callbacks will update further
    const total = [...findingsByEmail.values()].reduce((s, a) => s + a.length, 0);
    statusBar?.setState('idle', total);
  });

  // --------------------------------------------------------------------------
  // LLM commands (Sub-Task 7)
  // --------------------------------------------------------------------------
  context.subscriptions.push(
    registerExplainCommand(context, workspaceRoot, findingsByEmail, channel),
    registerSetApiKeyCommand(context),
    registerClearApiKeyCommand(context),
    registerTestConnectionCommand(context),
  );

  channel.appendLine('InterLens activated.');
}

// ---------------------------------------------------------------------------
// Helper: fetch teammate snapshot and dispatch analysis job
// ---------------------------------------------------------------------------

async function fetchAndRunAnalysis(
  change: TeammateSnapshotChange,
  workspaceRoot: string,
  mySnapshot: import('@interlens/core').OwnSnapshot,
  channel: vscode.OutputChannel,
  treeProvider: TeammateTreeDataProvider,
): Promise<void> {
  try {
    const { fetchTeammateSnapshot, emailToSlug } = await import('@interlens/core');
    const slug     = emailToSlug(change.userEmail);
    const localRef = `refs/interlens/remote/${slug}`;
    const theirSnapshot = await fetchTeammateSnapshot(workspaceRoot, localRef);
    if (!theirSnapshot) {
      channel.appendLine(
        `[InterLens] Could not read snapshot for ${change.userEmail} from ${localRef}.`,
      );
      return;
    }

    // Update tree view with snapshot (findings arrive via runner callback)
    treeProvider.updateTeammate(theirSnapshot as import('@interlens/core').TeammateSnapshot, findingsByEmail.get(change.userEmail) ?? []);

    // checkCommand and sharedTypePaths will be read from .interlens.yml
    // in Sub-Task 8; for now use defaults.
    const checkCommand    = 'npx tsc --noEmit -p .';
    const sharedTypePaths = ['shared/', 'types/', 'contracts/', 'interfaces/'];

    runner?.run({
      repoRoot: workspaceRoot,
      mySnapshot,
      theirSnapshot: theirSnapshot as import('@interlens/core').TeammateSnapshot,
      checkCommand,
      sharedTypePaths,
    });
  } catch (err) {
    channel.appendLine(
      `[InterLens] Error dispatching analysis for ${change.userEmail}: ${String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

export function deactivate(): void {
  runner?.dispose();
  producer?.dispose();
  notifier?.stop();
  statusBar?.dispose();
  diagnostics?.dispose();
  runner      = null;
  producer    = null;
  notifier    = null;
  statusBar   = null;
  diagnostics = null;
  treeProvider = null;
  findingsByEmail.clear();
}
