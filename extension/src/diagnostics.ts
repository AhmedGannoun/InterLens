/**
 * diagnostics.ts
 *
 * Converts Finding[] produced by the analysis worker into VS Code
 * DiagnosticCollection entries so findings appear in the Problems panel
 * with squiggles in the editor.
 *
 * Severity mapping (plan §VS Code Diagnostics and Output Channel):
 *   'error'   → DiagnosticSeverity.Error
 *   'warning' → DiagnosticSeverity.Warning
 *   'info'    → DiagnosticSeverity.Information
 *
 * source: "InterLens"
 * code:   finding.id  (used by interlens.explain to look up the finding)
 * range:  affectedLine/affectedColumn when available, else line 0 col 0
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Finding } from '@interlens/core';

/** DiagnosticCollection name as specified in the plan. */
export const COLLECTION_NAME = 'InterLens';

function severityOf(s: Finding['severity']): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':   return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    default:        return vscode.DiagnosticSeverity.Information;
  }
}

function rangeOf(f: Finding): vscode.Range {
  if (f.affectedLine !== undefined && f.affectedColumn !== undefined) {
    const line = Math.max(0, f.affectedLine);
    const col  = Math.max(0, f.affectedColumn);
    return new vscode.Range(line, col, line, col);
  }
  return new vscode.Range(0, 0, 0, 0);
}

/**
 * Rebuild the DiagnosticCollection from the current set of findings.
 *
 * @param collection  The DiagnosticCollection to update (mutated in place).
 * @param findings    All current findings (from all teammates).
 * @param workspaceRoot  Absolute path to the workspace root; used to resolve
 *                       relative file paths in findings.
 */
export function updateDiagnostics(
  collection: vscode.DiagnosticCollection,
  findings: Finding[],
  workspaceRoot: string,
): void {
  // Clear previous entries
  collection.clear();

  // Group findings by absolute file path
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const absPath = path.isAbsolute(finding.myFile)
      ? finding.myFile
      : path.join(workspaceRoot, finding.myFile);
    const existing = byFile.get(absPath) ?? [];
    existing.push(finding);
    byFile.set(absPath, existing);
  }

  // Build diagnostics per file
  const entries: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];
  for (const [absPath, filefindings] of byFile) {
    const diagnostics = filefindings.map((f) => {
      const diag = new vscode.Diagnostic(
        rangeOf(f),
        f.description,
        severityOf(f.severity),
      );
      diag.source = 'InterLens';
      diag.code = f.id;
      return diag;
    });
    entries.push([vscode.Uri.file(absPath), diagnostics]);
  }

  collection.set(entries);
}
