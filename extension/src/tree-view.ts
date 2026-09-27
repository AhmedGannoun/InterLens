/**
 * tree-view.ts
 *
 * Implements the `interlens.teammates` TreeDataProvider.
 *
 * Tree structure (plan §VS Code Extension Views):
 *   ├─ TeammateNode   — "Bob (main) · 2 findings"
 *   │   ├─ FindingNode  — "semantic-conflict  Property 'userId' does not exist…"
 *   │   └─ FindingNode  — "file-overlap  shared/types.ts"
 *   └─ TeammateNode   — "Carol (feature/auth) · 0 findings"
 *
 * Clicking a FindingNode navigates to the affected file at the finding's line.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Finding, TeammateSnapshot } from '@interlens/core';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

/** Represents one teammate in the tree. */
export class TeammateNode extends vscode.TreeItem {
  constructor(
    public readonly snapshot: TeammateSnapshot,
    public readonly findings: Finding[],
  ) {
    const label = snapshot.displayName || snapshot.userEmail;
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    const count = findings.length;
    this.description = count > 0
      ? `${snapshot.branch} · ${count} finding${count === 1 ? '' : 's'}`
      : `${snapshot.branch} · no findings`;
    this.tooltip = [
      `Email: ${snapshot.userEmail}`,
      `Branch: ${snapshot.branch}`,
      `Last seen: ${new Date(snapshot.timestamp).toLocaleTimeString()}`,
      `Findings: ${count}`,
    ].join('\n');
    this.iconPath = new vscode.ThemeIcon(count > 0 ? 'warning' : 'person');
    this.contextValue = 'teammate';
  }
}

/** Represents a single Finding under a teammate. */
export class FindingNode extends vscode.TreeItem {
  constructor(
    public readonly finding: Finding,
    public readonly workspaceRoot: string,
  ) {
    // Label: type + short description trimmed to 80 chars
    const shortDesc = finding.description.length > 80
      ? finding.description.slice(0, 77) + '…'
      : finding.description;
    super(`${finding.type}  ${shortDesc}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip    = finding.detail;
    this.iconPath   = new vscode.ThemeIcon(iconForSeverity(finding.severity));
    this.contextValue = 'finding';

    // Command: open the affected file at the affected line
    const absPath = path.isAbsolute(finding.myFile)
      ? finding.myFile
      : path.join(workspaceRoot, finding.myFile);

    const line   = Math.max(0, finding.affectedLine   ?? 0);
    const column = Math.max(0, finding.affectedColumn ?? 0);

    this.command = {
      command: 'vscode.open',
      title: 'Open file',
      arguments: [
        vscode.Uri.file(absPath),
        {
          selection: new vscode.Range(line, column, line, column),
          preserveFocus: false,
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
  }
}

function iconForSeverity(severity: Finding['severity']): string {
  switch (severity) {
    case 'error':   return 'error';
    case 'warning': return 'warning';
    default:        return 'info';
  }
}

// ---------------------------------------------------------------------------
// TeammateTreeDataProvider
// ---------------------------------------------------------------------------

type TreeNode = TeammateNode | FindingNode;

export class TeammateTreeDataProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** email → { snapshot, findings } */
  private readonly teammates = new Map<
    string,
    { snapshot: TeammateSnapshot; findings: Finding[] }
  >();

  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // ---------------------------------------------------------------------------
  // Mutation methods called by the extension
  // ---------------------------------------------------------------------------

  /**
   * Update (or add) a teammate entry and refresh the tree.
   */
  updateTeammate(snapshot: TeammateSnapshot, findings: Finding[]): void {
    this.teammates.set(snapshot.userEmail, { snapshot, findings });
    this._onDidChangeTreeData.fire();
  }

  /**
   * Replace all findings for a specific teammate email and refresh.
   */
  updateFindings(email: string, findings: Finding[]): void {
    const entry = this.teammates.get(email);
    if (entry) {
      entry.findings = findings;
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * Remove all findings for a teammate (e.g. they disconnected).
   */
  clearTeammate(email: string): void {
    this.teammates.delete(email);
    this._onDidChangeTreeData.fire();
  }

  /** Total number of findings across all teammates. */
  get totalFindingCount(): number {
    let n = 0;
    for (const { findings } of this.teammates.values()) n += findings.length;
    return n;
  }

  // ---------------------------------------------------------------------------
  // TreeDataProvider implementation
  // ---------------------------------------------------------------------------

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Root: one TeammateNode per teammate, sorted by display name
      return [...this.teammates.values()]
        .sort((a, b) =>
          (a.snapshot.displayName || a.snapshot.userEmail).localeCompare(
            b.snapshot.displayName || b.snapshot.userEmail,
          ),
        )
        .map(({ snapshot, findings }) => new TeammateNode(snapshot, findings));
    }

    if (element instanceof TeammateNode) {
      return element.findings.map(
        (f) => new FindingNode(f, this.workspaceRoot),
      );
    }

    // FindingNode has no children
    return [];
  }
}
