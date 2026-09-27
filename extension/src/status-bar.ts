/**
 * status-bar.ts
 *
 * Manages the InterLens status bar item on the left side of the VS Code
 * status bar.
 *
 * Three states (plan §Sub-Task 5):
 *   syncing  → $(sync-spin) InterLens
 *   idle     → $(check) InterLens
 *   error    → $(warning) InterLens: sync error
 *
 * The item is disposed when the extension is deactivated.
 */

import * as vscode from 'vscode';

export type StatusBarState = 'syncing' | 'idle' | 'error';

export class InterLensStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    // Left-side item, priority 100 so it appears near the left edge
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.name = 'InterLens';
    this.setState('idle');
    this.item.show();
  }

  /**
   * Update the displayed state.
   *
   * @param state  'syncing' | 'idle' | 'error'
   * @param findingCount  Optional count of current findings to append to the
   *                      idle/error tooltip.
   */
  setState(state: StatusBarState, findingCount?: number): void {
    switch (state) {
      case 'syncing':
        this.item.text    = '$(sync-spin) InterLens';
        this.item.tooltip = 'InterLens: syncing with teammates…';
        this.item.color   = undefined;
        break;

      case 'idle': {
        const count = findingCount ?? 0;
        this.item.text    = count > 0
          ? `$(check) InterLens (${count})`
          : '$(check) InterLens';
        this.item.tooltip = count > 0
          ? `InterLens: ${count} finding${count === 1 ? '' : 's'}`
          : 'InterLens: no findings';
        this.item.color   = undefined;
        break;
      }

      case 'error':
        this.item.text    = '$(warning) InterLens: sync error';
        this.item.tooltip = 'InterLens: could not reach the Git remote. Will retry.';
        this.item.color   = new vscode.ThemeColor('statusBarItem.warningForeground');
        break;
    }
  }

  /** Show/hide the item. */
  show(): void  { this.item.show(); }
  hide(): void  { this.item.hide(); }

  dispose(): void { this.item.dispose(); }
}
