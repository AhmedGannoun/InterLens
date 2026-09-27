// @interlens/core — public barrel export

export * from './types';
export * from './snapshot';
export { GitPollingNotifier } from './notifier/git-polling';
export type { GitPollingNotifierOptions } from './notifier/git-polling';
export { runAnalysis } from './analysis';
export { tryMerge, materializeTree, clearMaterialisedCache } from './engines/merge';
export { runCheck, diffErrors, parseTscOutput, detectUnambiguousRename, clearCheckCache } from './engines/tsc';
export { detectCollisions } from './engines/collision';
export {
  extractRoutes,
  extractCalls,
  compareEndpoints,
  normalizePath,
  normalizeUrl,
} from './engines/endpoints';
export type { Route, ApiCall, ExtractResult } from './engines/endpoints';

// LLM providers
export {
  TemplateProvider,
  OpenAIProvider,
  AnthropicProvider,
  OpenAICompatProvider,
  IbmBobProvider,
  createProvider,
  buildCacheKey,
  getFromCache,
  setInCache,
  clearCache,
  cacheSize,
  buildUserPrompt,
  collectOpenAIStream,
  collectAnthropicStream,
  SYSTEM_PROMPT,
} from './llm/index';
export type {
  OpenAIProviderOptions,
  AnthropicProviderOptions,
  OpenAICompatProviderOptions,
  IbmBobProviderOptions,
  CreateProviderOptions,
  LLMProviderId,
} from './llm/index';
