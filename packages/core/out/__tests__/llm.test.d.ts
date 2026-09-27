/**
 * llm.test.ts — Sub-Task 7
 *
 * Unit tests for all packages/core LLM modules:
 *   - buildCacheKey, getFromCache, setInCache, clearCache, cacheSize (cache.ts)
 *   - TemplateProvider (template.ts)
 *   - buildUserPrompt, collectOpenAIStream (openai.ts)
 *   - collectAnthropicStream (anthropic.ts)
 *   - IbmBobProvider fallback when baseUrl is empty (ibm-bob.ts)
 *   - OpenAICompatProvider fallback when baseUrl is empty (openai-compat.ts)
 *   - createProvider factory (llm/index.ts)
 *   - SYSTEM_PROMPT content sanity (system-prompt.ts)
 *
 * Network-calling providers (OpenAI, Anthropic, IBM Bob with real URL) are not
 * tested against live endpoints — they require real API keys and aren't suitable
 * for CI. Their unit-testable pure functions (stream parsers, prompt builders)
 * ARE tested here using mock ReadableStreams.
 */
export {};
//# sourceMappingURL=llm.test.d.ts.map