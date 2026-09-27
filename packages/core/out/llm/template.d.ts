/**
 * template.ts — "none" ExplanationProvider
 *
 * Returns finding.detail formatted as markdown with no network call.
 * Used when the provider setting is "none" or as a fallback.
 * No vscode imports allowed in this file.
 */
import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
export declare class TemplateProvider implements ExplanationProvider {
    readonly id = "none";
    explain(input: ExplainInput, _signal: AbortSignal): Promise<ExplainResult>;
    testConnection(): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=template.d.ts.map