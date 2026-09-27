"use strict";
/**
 * anthropic.ts — Anthropic ExplanationProvider (streaming SSE).
 *
 * Uses the Messages endpoint with Anthropic-format SSE streaming.
 * No vscode imports allowed in this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
exports.collectAnthropicStream = collectAnthropicStream;
const system_prompt_1 = require("./system-prompt");
const openai_1 = require("./openai");
const BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/**
 * Parse an Anthropic SSE stream (`event: content_block_delta`) and collect text.
 * Calls onToken for each incremental token if provided.
 */
async function collectAnthropicStream(body, signal, onToken) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';
    let currentEvent = '';
    try {
        while (true) {
            if (signal.aborted)
                throw new Error('Request aborted');
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('event: ')) {
                    currentEvent = trimmed.slice('event: '.length).trim();
                    continue;
                }
                if (trimmed.startsWith('data: ')) {
                    const json = trimmed.slice('data: '.length);
                    if (!json || json === '[DONE]')
                        continue;
                    // Only process content_block_delta events
                    if (currentEvent !== 'content_block_delta')
                        continue;
                    try {
                        const parsed = JSON.parse(json);
                        if (parsed.delta?.type === 'text_delta') {
                            const token = parsed.delta.text ?? '';
                            if (token) {
                                result += token;
                                onToken?.(token);
                            }
                        }
                    }
                    catch {
                        // ignore malformed SSE lines
                    }
                    continue;
                }
                if (trimmed === '') {
                    currentEvent = '';
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    return result;
}
class AnthropicProvider {
    constructor(options) {
        this.options = options;
        this.id = 'anthropic';
        this.model = options.model || 'claude-haiku-4-5';
        this.timeoutMs = options.timeoutMs ?? 20000;
    }
    async explain(input, signal) {
        const requestBody = JSON.stringify({
            model: this.model,
            max_tokens: 512,
            system: system_prompt_1.SYSTEM_PROMPT,
            messages: [{ role: 'user', content: (0, openai_1.buildUserPrompt)(input) }],
            stream: true,
        });
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
        const combinedSignal = combineSignals(signal, timeoutController.signal);
        try {
            const response = await fetch(`${BASE_URL}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.options.apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
                },
                body: requestBody,
                signal: combinedSignal,
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
            }
            if (!response.body) {
                throw new Error('Anthropic API returned no response body');
            }
            const markdown = await collectAnthropicStream(response.body, combinedSignal);
            return { markdown: markdown.trim(), fromCache: false };
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async testConnection() {
        // Anthropic has no lightweight /models endpoint accessible without a model list.
        // Make a minimal non-streaming request with max_tokens=1.
        try {
            const response = await fetch(`${BASE_URL}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.options.apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'ping' }],
                }),
                signal: AbortSignal.timeout(10000),
            });
            // 200 or 400 (bad request — key is valid but model/params may vary) both indicate auth passed
            if (response.status === 401 || response.status === 403) {
                return { ok: false, error: `Authentication failed (HTTP ${response.status})` };
            }
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: String(err) };
        }
    }
}
exports.AnthropicProvider = AnthropicProvider;
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
//# sourceMappingURL=anthropic.js.map