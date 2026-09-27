/**
 * index.ts — LLM provider barrel + factory.
 *
 * createProvider() is the single entry point for constructing a provider.
 * No vscode imports allowed in this file.
 */
export { TemplateProvider } from './template';
export { OpenAIProvider } from './openai';
export type { OpenAIProviderOptions } from './openai';
export { buildUserPrompt, collectOpenAIStream } from './openai';
export { AnthropicProvider } from './anthropic';
export type { AnthropicProviderOptions } from './anthropic';
export { collectAnthropicStream } from './anthropic';
export { OpenAICompatProvider } from './openai-compat';
export type { OpenAICompatProviderOptions } from './openai-compat';
export { IbmBobProvider } from './ibm-bob';
export type { IbmBobProviderOptions } from './ibm-bob';
export { buildCacheKey, getFromCache, setInCache, clearCache, cacheSize } from './cache';
export { SYSTEM_PROMPT } from './system-prompt';
import type { ExplanationProvider } from '../types';
export type LLMProviderId = 'ibm-bob' | 'openai' | 'anthropic' | 'openai-compatible' | 'none';
export interface CreateProviderOptions {
    provider: LLMProviderId;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    teamId?: string;
    timeoutMs?: number;
}
/**
 * Factory function that creates the appropriate ExplanationProvider.
 * All network providers require the relevant credentials; missing values
 * cause the provider to return errors or fall back gracefully (ibm-bob).
 */
export declare function createProvider(opts: CreateProviderOptions): ExplanationProvider;
//# sourceMappingURL=index.d.ts.map