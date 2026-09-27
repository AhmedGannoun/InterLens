/**
 * template.ts — "none" ExplanationProvider
 *
 * Returns finding.detail formatted as markdown with no network call.
 * Used when the provider setting is "none" or as a fallback.
 * No vscode imports allowed in this file.
 */

import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';

export class TemplateProvider implements ExplanationProvider {
  readonly id = 'none';

  async explain(input: ExplainInput, _signal: AbortSignal): Promise<ExplainResult> {
    const { finding } = input;
    const markdown = [
      `**${finding.description}**`,
      '',
      finding.detail,
      '',
      `*Teammate: ${finding.teammateName} (${finding.teammateEmail})*`,
      `*Files: \`${finding.myFile}\` ↔ \`${finding.theirFile}\`*`,
    ].join('\n');

    return { markdown, fromCache: false };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    // No network — always succeeds.
    return { ok: true };
  }
}
