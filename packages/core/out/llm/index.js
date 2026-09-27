"use strict";
/**
 * index.ts — LLM provider barrel + factory.
 *
 * createProvider() is the single entry point for constructing a provider.
 * No vscode imports allowed in this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_PROMPT = exports.cacheSize = exports.clearCache = exports.setInCache = exports.getFromCache = exports.buildCacheKey = exports.IbmBobProvider = exports.OpenAICompatProvider = exports.collectAnthropicStream = exports.AnthropicProvider = exports.collectOpenAIStream = exports.buildUserPrompt = exports.OpenAIProvider = exports.TemplateProvider = void 0;
exports.createProvider = createProvider;
var template_1 = require("./template");
Object.defineProperty(exports, "TemplateProvider", { enumerable: true, get: function () { return template_1.TemplateProvider; } });
var openai_1 = require("./openai");
Object.defineProperty(exports, "OpenAIProvider", { enumerable: true, get: function () { return openai_1.OpenAIProvider; } });
var openai_2 = require("./openai");
Object.defineProperty(exports, "buildUserPrompt", { enumerable: true, get: function () { return openai_2.buildUserPrompt; } });
Object.defineProperty(exports, "collectOpenAIStream", { enumerable: true, get: function () { return openai_2.collectOpenAIStream; } });
var anthropic_1 = require("./anthropic");
Object.defineProperty(exports, "AnthropicProvider", { enumerable: true, get: function () { return anthropic_1.AnthropicProvider; } });
var anthropic_2 = require("./anthropic");
Object.defineProperty(exports, "collectAnthropicStream", { enumerable: true, get: function () { return anthropic_2.collectAnthropicStream; } });
var openai_compat_1 = require("./openai-compat");
Object.defineProperty(exports, "OpenAICompatProvider", { enumerable: true, get: function () { return openai_compat_1.OpenAICompatProvider; } });
var ibm_bob_1 = require("./ibm-bob");
Object.defineProperty(exports, "IbmBobProvider", { enumerable: true, get: function () { return ibm_bob_1.IbmBobProvider; } });
var cache_1 = require("./cache");
Object.defineProperty(exports, "buildCacheKey", { enumerable: true, get: function () { return cache_1.buildCacheKey; } });
Object.defineProperty(exports, "getFromCache", { enumerable: true, get: function () { return cache_1.getFromCache; } });
Object.defineProperty(exports, "setInCache", { enumerable: true, get: function () { return cache_1.setInCache; } });
Object.defineProperty(exports, "clearCache", { enumerable: true, get: function () { return cache_1.clearCache; } });
Object.defineProperty(exports, "cacheSize", { enumerable: true, get: function () { return cache_1.cacheSize; } });
var system_prompt_1 = require("./system-prompt");
Object.defineProperty(exports, "SYSTEM_PROMPT", { enumerable: true, get: function () { return system_prompt_1.SYSTEM_PROMPT; } });
const template_2 = require("./template");
const openai_3 = require("./openai");
const anthropic_3 = require("./anthropic");
const openai_compat_2 = require("./openai-compat");
const ibm_bob_2 = require("./ibm-bob");
/**
 * Factory function that creates the appropriate ExplanationProvider.
 * All network providers require the relevant credentials; missing values
 * cause the provider to return errors or fall back gracefully (ibm-bob).
 */
function createProvider(opts) {
    const apiKey = opts.apiKey ?? '';
    const timeoutMs = opts.timeoutMs ?? 20000;
    switch (opts.provider) {
        case 'openai':
            return new openai_3.OpenAIProvider({
                apiKey,
                baseUrl: opts.baseUrl,
                model: opts.model,
                timeoutMs,
            });
        case 'anthropic':
            return new anthropic_3.AnthropicProvider({
                apiKey,
                model: opts.model,
                timeoutMs,
            });
        case 'openai-compatible':
            return new openai_compat_2.OpenAICompatProvider({
                baseUrl: opts.baseUrl ?? '',
                model: opts.model ?? '',
                apiKey: apiKey || undefined,
                timeoutMs,
            });
        case 'ibm-bob':
            return new ibm_bob_2.IbmBobProvider({
                baseUrl: opts.baseUrl ?? '',
                apiKey,
                teamId: opts.teamId,
                model: opts.model,
                timeoutMs,
            });
        case 'none':
        default:
            return new template_2.TemplateProvider();
    }
}
//# sourceMappingURL=index.js.map