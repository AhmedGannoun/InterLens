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
import { TemplateProvider } from './template';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatProvider } from './openai-compat';
import { IbmBobProvider } from './ibm-bob';

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
export function createProvider(opts: CreateProviderOptions): ExplanationProvider {
  const apiKey = opts.apiKey ?? '';
  const timeoutMs = opts.timeoutMs ?? 20_000;

  switch (opts.provider) {
    case 'openai':
      return new OpenAIProvider({
        apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        timeoutMs,
      });

    case 'anthropic':
      return new AnthropicProvider({
        apiKey,
        model: opts.model,
        timeoutMs,
      });

    case 'openai-compatible':
      return new OpenAICompatProvider({
        baseUrl: opts.baseUrl ?? '',
        model: opts.model ?? '',
        apiKey: apiKey || undefined,
        timeoutMs,
      });

    case 'ibm-bob':
      return new IbmBobProvider({
        baseUrl: opts.baseUrl ?? '',
        apiKey,
        teamId: opts.teamId,
        model: opts.model,
        timeoutMs,
      });

    case 'none':
    default:
      return new TemplateProvider();
  }
}
