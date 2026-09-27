/**
 * ibm-bob.ts — IBM Bob ExplanationProvider.
 *
 * OpenAI Chat Completions-compatible, with:
 *   - Base URL from settings (required — no default).
 *   - Optional X-Bob-Team-Id header.
 *   - Graceful fallback to template explanation when base URL is empty.
 * No vscode imports allowed in this file.
 */
import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
export interface IbmBobProviderOptions {
    /** Base URL for the IBM Bob instance (required). If empty, falls back to template. */
    baseUrl: string;
    /** API key for Authorization: Bearer header. */
    apiKey: string;
    /** Optional team ID added as X-Bob-Team-Id header. */
    teamId?: string;
    /** Model identifier. Defaults to empty string (server picks). */
    model?: string;
    /** Request timeout in ms (default: 20000). */
    timeoutMs?: number;
}
export declare class IbmBobProvider implements ExplanationProvider {
    private readonly options;
    readonly id = "ibm-bob";
    private readonly baseUrl;
    private readonly model;
    private readonly timeoutMs;
    private readonly fallback;
    constructor(options: IbmBobProviderOptions);
    explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
    testConnection(): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=ibm-bob.d.ts.map