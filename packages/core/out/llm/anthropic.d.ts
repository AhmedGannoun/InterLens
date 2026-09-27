/**
 * anthropic.ts — Anthropic ExplanationProvider (streaming SSE).
 *
 * Uses the Messages endpoint with Anthropic-format SSE streaming.
 * No vscode imports allowed in this file.
 */
import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
export interface AnthropicProviderOptions {
    /** API key for x-api-key header. */
    apiKey: string;
    /** Model identifier (default: claude-haiku-4-5). */
    model?: string;
    /** Request timeout in ms (default: 20000). */
    timeoutMs?: number;
}
/**
 * Parse an Anthropic SSE stream (`event: content_block_delta`) and collect text.
 * Calls onToken for each incremental token if provided.
 */
export declare function collectAnthropicStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onToken?: (token: string) => void): Promise<string>;
export declare class AnthropicProvider implements ExplanationProvider {
    private readonly options;
    readonly id = "anthropic";
    private readonly model;
    private readonly timeoutMs;
    constructor(options: AnthropicProviderOptions);
    explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
    testConnection(): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=anthropic.d.ts.map