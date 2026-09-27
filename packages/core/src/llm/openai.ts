/**
 * openai.ts — OpenAI ExplanationProvider (streaming SSE).
 *
 * Uses the Chat Completions endpoint with SSE streaming.
 * No vscode imports allowed in this file.
 */

import type { ExplanationProvider, ExplainInput, ExplainResult } from '../types';
import { SYSTEM_PROMPT } from './system-prompt';

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
export function buildUserPrompt(input: ExplainInput): string {
  const { finding } = input;
  const lines: string[] = [
    `Finding type: ${finding.type}`,
    `My file: ${finding.myFile}`,
    `Teammate file: ${finding.theirFile}`,
    `Teammate: ${finding.teammateName} (${finding.teammateEmail})`,
    '',
    `Description: ${finding.description}`,
    '',
  ];
  if (finding.tscError) {
    lines.push(`TypeScript error: ${finding.tscError}`, '');
  }
  if (input.myDiffHunk) {
    lines.push('My diff hunk:', '```diff', input.myDiffHunk, '```', '');
  }
  if (input.theirDiffHunk) {
    lines.push("Teammate's diff hunk:", '```diff', input.theirDiffHunk, '```', '');
  }
  return lines.join('\n');
}

/**
 * Parse an OpenAI SSE stream and collect the full text response.
 * Calls onToken for each incremental token if provided.
 */
export async function collectOpenAIStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onToken?: (token: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';

  try {
    while (true) {
      if (signal.aborted) throw new Error('Request aborted');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        const json = trimmed.slice('data: '.length);
        try {
          const parsed = JSON.parse(json) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = parsed.choices?.[0]?.delta?.content ?? '';
          if (token) {
            result += token;
            onToken?.(token);
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}

export class OpenAIProvider implements ExplanationProvider {
  readonly id = 'openai';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model || 'gpt-4o-mini';
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      stream: true,
    });

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    // Combine caller signal + our timeout
    const combinedSignal = this.combineSignals(signal, timeoutController.signal);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body,
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('OpenAI API returned no response body');
      }

      const markdown = await collectOpenAIStream(response.body, combinedSignal);
      return { markdown: markdown.trim(), fromCache: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
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

  private combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
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
}
