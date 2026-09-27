"use strict";
/**
 * openai-compat.ts — OpenAI-compatible ExplanationProvider.
 *
 * Same as the OpenAI provider but with a user-supplied base URL and model.
 * Used for any service that speaks OpenAI Chat Completions protocol.
 * No vscode imports allowed in this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatProvider = void 0;
const system_prompt_1 = require("./system-prompt");
const openai_1 = require("./openai");
class OpenAICompatProvider {
    constructor(options) {
        this.options = options;
        this.id = 'openai-compatible';
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.timeoutMs = options.timeoutMs ?? 20000;
    }
    async explain(input, signal) {
        if (!this.options.baseUrl) {
            return {
                markdown: 'OpenAI-compatible base URL is not configured. Please set `interlens.llm.baseUrl`.',
                fromCache: false,
            };
        }
        const requestBody = JSON.stringify({
            model: this.options.model,
            messages: [
                { role: 'system', content: system_prompt_1.SYSTEM_PROMPT },
                { role: 'user', content: (0, openai_1.buildUserPrompt)(input) },
            ],
            stream: true,
        });
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.options.apiKey) {
            headers['Authorization'] = `Bearer ${this.options.apiKey}`;
        }
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
        const combinedSignal = combineSignals(signal, timeoutController.signal);
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: requestBody,
                signal: combinedSignal,
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`OpenAI-compatible API error ${response.status}: ${errorText}`);
            }
            if (!response.body) {
                throw new Error('OpenAI-compatible API returned no response body');
            }
            const markdown = await (0, openai_1.collectOpenAIStream)(response.body, combinedSignal);
            return { markdown: markdown.trim(), fromCache: false };
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async testConnection() {
        if (!this.options.baseUrl) {
            return { ok: false, error: 'Base URL not configured' };
        }
        try {
            const headers = {};
            if (this.options.apiKey) {
                headers['Authorization'] = `Bearer ${this.options.apiKey}`;
            }
            const response = await fetch(`${this.baseUrl}/models`, {
                headers,
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) {
                return { ok: false, error: `HTTP ${response.status}` };
            }
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: String(err) };
        }
    }
}
exports.OpenAICompatProvider = OpenAICompatProvider;
function combineSignals(a, b) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (a.aborted || b.aborted) {
        controller.abort();
    }
    else {
        a.addEventListener('abort', abort, { once: true });
        b.addEventListener('abort', abort, { once: true });
    }
    return controller.signal;
}
//# sourceMappingURL=openai-compat.js.map