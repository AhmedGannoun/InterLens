/**
 * openai-compat.ts — OpenAI-compatible ExplanationProvider.
 *
 * Same as the OpenAI provider but with a user-supplied base URL and model.
 * Used for any service that speaks OpenAI Chat Completions protocol.
 * No vscode imports allowed in this file.
 */

import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
import { SYSTEM_PROMPT } from './system-prompt';
import { buildUserPrompt, collectOpenAIStream } from './openai';

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

export class OpenAICompatProvider implements ExplanationProvider {
  readonly id = 'openai-compatible';

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult> {
    if (!this.options.baseUrl) {
      return {
        markdown: 'OpenAI-compatible base URL is not configured. Please set `interlens.llm.baseUrl`.',
        fromCache: false,
      };
    }

    const requestBody = JSON.stringify({
      model: this.options.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      stream: true,
    });

    const headers: Record<string, string> = {
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

      const markdown = await collectOpenAIStream(response.body, combinedSignal);
      return { markdown: markdown.trim(), fromCache: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.options.baseUrl) {
      return { ok: false, error: 'Base URL not configured' };
    }
    try {
      const headers: Record<string, string> = {};
      if (this.options.apiKey) {
        headers['Authorization'] = `Bearer ${this.options.apiKey}`;
      }
      const response = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener('abort', abort, { once: true });
    b.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}
