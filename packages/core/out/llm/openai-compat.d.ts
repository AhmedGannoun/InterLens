/**
 * openai-compat.ts — OpenAI-compatible ExplanationProvider.
 *
 * Same as the OpenAI provider but with a user-supplied base URL and model.
 * Used for any service that speaks OpenAI Chat Completions protocol.
 * No vscode imports allowed in this file.
 */
import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
export interface OpenAICompatProviderOptions {
    /** Base URL for the OpenAI-compatible endpoint (required). */
    baseUrl: string;
    /** Model identifier (required). */
    model: string;
    /** Optional API key. Omit if the server requires no auth. */
    apiKey?: string;
    /** Request timeout in ms (default: 20000). */
    timeoutMs?: number;
}
export declare class OpenAICompatProvider implements ExplanationProvider {
    private readonly options;
    readonly id = "openai-compatible";
    private readonly baseUrl;
    private readonly timeoutMs;
    constructor(options: OpenAICompatProviderOptions);
    explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
    testConnection(): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=openai-compat.d.ts.map