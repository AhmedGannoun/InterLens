/**
 * snapshot-producer.ts
 *
 * Registers VS Code document-save events, debounces them, and calls
 * createSnapshot + announceSnapshot from @interlens/core.
 *
 * This is the only file in the extension that bridges VS Code APIs with the
 * core snapshot logic.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { createSnapshot, announceSnapshot } from '@interlens/core';

export interface SnapshotProducerOptions {
  /** Debounce delay in ms before pushing a snapshot after a save. */
  debounceMs: number;
  /** Developer display name (from settings; may be empty → falls back to git config). */
  displayName: string;
  /** Developer email (from settings; may be empty → falls back to git config). */
  userEmail: string;
  /** Called when a push fails, so the extension can log or show a warning. */
  onError?: (err: unknown) => void;
}

export class SnapshotProducer {
  private readonly options: SnapshotProducerOptions;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(options: SnapshotProducerOptions) {
    this.options = options;
  }

  /** Call from extension.activate() — registers the save listener. */
  activate(context: vscode.ExtensionContext): void {
    const listener = vscode.workspace.onDidSaveTextDocument((doc) => {
      this.handleSave(doc);
    });
    this.disposables.push(listener);
    context.subscriptions.push(listener);
  }

  /** Call from extension.deactivate() — clears any pending debounce. */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private handleSave(doc: vscode.TextDocument): void {
    // Only act on documents inside a workspace folder
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!workspaceFolder) return;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.push(workspaceFolder.uri.fsPath);
    }, this.options.debounceMs);
  }

  private async push(repoRoot: string): Promise<void> {
    try {
      const snapshot = await createSnapshot(
        repoRoot,
        this.options.userEmail,
        this.options.displayName,
      );
      await announceSnapshot(repoRoot, snapshot);
    } catch (err: unknown) {
      this.options.onError?.(err);
    }
  }
}

/**
 * Resolve the workspace root for a given file path.
 * Exported for use in extension.ts activation logic.
 */
export function resolveRepoRoot(filePath: string): string {
  return path.dirname(filePath);
}
