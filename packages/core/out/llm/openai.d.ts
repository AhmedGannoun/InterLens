/**
 * openai.ts — OpenAI ExplanationProvider (streaming SSE).
 *
 * Uses the Chat Completions endpoint with SSE streaming.
 * No vscode imports allowed in this file.
 */
import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
export interface OpenAIProviderOptions {
    /** API key for Authorization: Bearer header. */
    apiKey: string;
    /** Override base URL (default: https://api.openai.com/v1). */
    baseUrl?: string;
    /** Model identifier (default: gpt-4o-mini). */
    model?: string;
    /** Request timeout in ms (default: 20000). */
    timeoutMs?: number;
}
/**
 * Build the user prompt from an ExplainInput.
 */
export declare function buildUserPrompt(input: ExplainInput): string;
/**
 * Parse an OpenAI SSE stream and collect the full text response.
 * Calls onToken for each incremental token if provided.
 */
export declare function collectOpenAIStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onToken?: (token: string) => void): Promise<string>;
export declare class OpenAIProvider implements ExplanationProvider {
    private readonly options;
    readonly id = "openai";
    private readonly baseUrl;
    private readonly model;
    private readonly timeoutMs;
    constructor(options: OpenAIProviderOptions);
    explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
    testConnection(): Promise<{
        ok: boolean;
        error?: string;
    }>;
    private combineSignals;
}
//# sourceMappingURL=openai.d.ts.map