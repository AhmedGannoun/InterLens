/**
 * ibm-bob.ts — IBM Bob ExplanationProvider.
 *
 * OpenAI Chat Completions-compatible, with:
 *   - Base URL from settings (required — no default).
 *   - Optional X-Bob-Team-Id header.
 *   - Graceful fallback to template explanation when base URL is empty.
 * No vscode imports allowed in this file.
 */

import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
import { SYSTEM_PROMPT } from './system-prompt';
import { buildUserPrompt, collectOpenAIStream } from './openai';
import { TemplateProvider } from './template';

export interface IbmBobProviderOptions {
  /** Base URL for the IBM Bob instance (required). If empty, falls back to template. */
  baseUrl: string;
  /** API key for Authorization: Bearer header. */
  apiKey: string;
  /** Optional team ID added as X-Bob-Team-Id header. */
  teamId?: string;
  /** Model identifier. Defaults to empty string (server picks). */
  model?: string;
  /** Request timeout in ms (default: 20000). */
  timeoutMs?: number;
}

export class IbmBobProvider implements ExplanationProvider {
  readonly id = 'ibm-bob';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fallback = new TemplateProvider();

  constructor(private readonly options: IbmBobProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model ?? '';
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult> {
    if (!this.options.baseUrl) {
      // Graceful fallback — return template explanation + config hint
      const templateResult = await this.fallback.explain(input, signal);
      return {
        markdown: [
          templateResult.markdown,
          '',
          '---',
          '*IBM Bob base URL not configured. [Fix settings](command:workbench.action.openSettings?%5B%22interlens.llm%22%5D)*',
        ].join('\n'),
        fromCache: false,
      };
    }

    const requestBody = JSON.stringify({
      model: this.model || undefined,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      stream: true,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.apiKey}`,
    };
    if (this.options.teamId) {
      headers['X-Bob-Team-Id'] = this.options.teamId;
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
        throw new Error(`IBM Bob API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('IBM Bob API returned no response body');
      }

      const markdown = await collectOpenAIStream(response.body, combinedSignal);
      return { markdown: markdown.trim(), fromCache: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.options.baseUrl) {
      return { ok: false, error: 'IBM Bob base URL not configured' };
    }
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.options.apiKey}`,
      };
      if (this.options.teamId) {
        headers['X-Bob-Team-Id'] = this.options.teamId;
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
