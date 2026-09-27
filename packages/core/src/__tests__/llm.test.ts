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

import { Readable } from 'stream';

// Cache module
import {
  buildCacheKey,
  getFromCache,
  setInCache,
  clearCache,
  cacheSize,
} from '../llm/cache';

// Template provider
import { TemplateProvider } from '../llm/template';

// OpenAI helpers
import { buildUserPrompt, collectOpenAIStream } from '../llm/openai';

// Anthropic helpers
import { collectAnthropicStream } from '../llm/anthropic';

// IBM Bob provider (tests the empty-baseUrl fallback)
import { IbmBobProvider } from '../llm/ibm-bob';

// OpenAI-compatible provider (tests the empty-baseUrl fallback)
import { OpenAICompatProvider } from '../llm/openai-compat';

// Factory
import { createProvider } from '../llm/index';

// SYSTEM_PROMPT
import { SYSTEM_PROMPT } from '../llm/system-prompt';

// Types
import type { Finding, ExplainInput } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'test-finding-id',
    type: 'semantic-conflict',
    severity: 'error',
    myFile: 'frontend/login.ts',
    theirFile: 'shared/types.ts',
    teammateEmail: 'bob@demo.dev',
    teammateName: 'Bob',
    description: "Bob renamed AuthResponse.userId → id",
    detail: "Bob renamed the field userId to id in AuthResponse. Your code still reads userId.",
    mySnapshotHash: 'abc123',
    theirSnapshotHash: 'def456',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    finding: makeFinding(),
    myDiffHunk: '-  console.log(response.userId);\n+  console.log(response.id);',
    theirDiffHunk: '-  userId: string;\n+  id: string;',
    ...overrides,
  };
}

/**
 * Create a Web-API-compatible ReadableStream from a list of SSE chunks.
 * Each chunk is a string that will be encoded as UTF-8 bytes.
 */
function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// cache.ts
// ---------------------------------------------------------------------------

describe('cache: buildCacheKey', () => {
  beforeEach(() => clearCache());

  it('returns a 64-character hex string (SHA-256)', () => {
    const finding = makeFinding();
    const key = buildCacheKey(finding);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce same key', () => {
    const f = makeFinding();
    expect(buildCacheKey(f)).toBe(buildCacheKey(f));
  });

  it('changes when finding.id changes', () => {
    const a = makeFinding({ id: 'id-a' });
    const b = makeFinding({ id: 'id-b' });
    expect(buildCacheKey(a)).not.toBe(buildCacheKey(b));
  });

  it('changes when mySnapshotHash changes', () => {
    const a = makeFinding({ mySnapshotHash: 'snap-a' });
    const b = makeFinding({ mySnapshotHash: 'snap-b' });
    expect(buildCacheKey(a)).not.toBe(buildCacheKey(b));
  });

  it('changes when theirSnapshotHash changes', () => {
    const a = makeFinding({ theirSnapshotHash: 'snap-a' });
    const b = makeFinding({ theirSnapshotHash: 'snap-b' });
    expect(buildCacheKey(a)).not.toBe(buildCacheKey(b));
  });
});

describe('cache: get/set/clear', () => {
  beforeEach(() => clearCache());

  it('returns undefined for a key not yet in cache', () => {
    expect(getFromCache('missing-key')).toBeUndefined();
  });

  it('stores and retrieves a result', () => {
    const result = { markdown: 'hello', fromCache: false };
    setInCache('k1', result);
    const got = getFromCache('k1');
    expect(got).toBeDefined();
    expect(got!.markdown).toBe('hello');
  });

  it('sets fromCache = true on the stored copy', () => {
    setInCache('k2', { markdown: 'x', fromCache: false });
    expect(getFromCache('k2')!.fromCache).toBe(true);
  });

  it('does not mutate the original result object', () => {
    const original = { markdown: 'y', fromCache: false };
    setInCache('k3', original);
    expect(original.fromCache).toBe(false); // original unchanged
  });

  it('cacheSize reflects stored entries', () => {
    expect(cacheSize()).toBe(0);
    setInCache('a', { markdown: '', fromCache: false });
    setInCache('b', { markdown: '', fromCache: false });
    expect(cacheSize()).toBe(2);
  });

  it('clearCache empties the store', () => {
    setInCache('x', { markdown: '', fromCache: false });
    clearCache();
    expect(cacheSize()).toBe(0);
    expect(getFromCache('x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// template.ts — TemplateProvider
// ---------------------------------------------------------------------------

describe('TemplateProvider', () => {
  const provider = new TemplateProvider();

  it('has id "none"', () => {
    expect(provider.id).toBe('none');
  });

  it('explain() resolves with markdown containing the description', async () => {
    const result = await provider.explain(makeInput(), new AbortController().signal);
    expect(result.markdown).toContain('Bob renamed AuthResponse.userId');
    expect(result.fromCache).toBe(false);
  });

  it('explain() includes teammate name and email', async () => {
    const result = await provider.explain(makeInput(), new AbortController().signal);
    expect(result.markdown).toContain('bob@demo.dev');
    expect(result.markdown).toContain('Bob');
  });

  it('explain() includes the file paths', async () => {
    const result = await provider.explain(makeInput(), new AbortController().signal);
    expect(result.markdown).toContain('frontend/login.ts');
    expect(result.markdown).toContain('shared/types.ts');
  });

  it('testConnection() returns ok: true', async () => {
    const r = await provider.testConnection();
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// openai.ts — buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  it('includes the finding type', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain('semantic-conflict');
  });

  it('includes the teammate email', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain('bob@demo.dev');
  });

  it('includes the tscError when present', () => {
    const input = makeInput({ finding: makeFinding({ tscError: "Property 'userId' does not exist" }) });
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("Property 'userId' does not exist");
  });

  it('omits the tscError section when not present', () => {
    const input = makeInput({ finding: makeFinding({ tscError: undefined }) });
    const prompt = buildUserPrompt(input);
    expect(prompt).not.toContain('TypeScript error:');
  });

  it('includes myDiffHunk in a code fence', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain('My diff hunk:');
    expect(prompt).toContain('```diff');
  });

  it('includes theirDiffHunk in a code fence', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain("Teammate's diff hunk:");
  });

  it('omits diff sections when hunks are empty', () => {
    const input = makeInput({ myDiffHunk: '', theirDiffHunk: '' });
    const prompt = buildUserPrompt(input);
    expect(prompt).not.toContain('```diff');
  });
});

// ---------------------------------------------------------------------------
// openai.ts — collectOpenAIStream
// ---------------------------------------------------------------------------

describe('collectOpenAIStream', () => {
  function openAIChunk(content: string): string {
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
  }

  it('collects tokens into a single string', async () => {
    const chunks = [
      openAIChunk('Hello'),
      openAIChunk(', '),
      openAIChunk('world!'),
      'data: [DONE]\n',
    ];
    const stream = makeReadableStream(chunks);
    const result = await collectOpenAIStream(stream, new AbortController().signal);
    expect(result).toBe('Hello, world!');
  });

  it('calls onToken for each token', async () => {
    const chunks = [openAIChunk('A'), openAIChunk('B'), 'data: [DONE]\n'];
    const stream = makeReadableStream(chunks);
    const tokens: string[] = [];
    await collectOpenAIStream(stream, new AbortController().signal, (t) => tokens.push(t));
    expect(tokens).toEqual(['A', 'B']);
  });

  it('ignores malformed JSON data lines', async () => {
    const chunks = ['data: not-valid-json\n', openAIChunk('ok'), 'data: [DONE]\n'];
    const stream = makeReadableStream(chunks);
    const result = await collectOpenAIStream(stream, new AbortController().signal);
    expect(result).toBe('ok');
  });

  it('ignores non-data lines (blank, comments)', async () => {
    const chunks = ['\n', openAIChunk('hi'), '\n', 'data: [DONE]\n'];
    const stream = makeReadableStream(chunks);
    const result = await collectOpenAIStream(stream, new AbortController().signal);
    expect(result).toBe('hi');
  });

  it('returns empty string for a stream with only [DONE]', async () => {
    const stream = makeReadableStream(['data: [DONE]\n']);
    const result = await collectOpenAIStream(stream, new AbortController().signal);
    expect(result).toBe('');
  });

  it('throws when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const stream = makeReadableStream([openAIChunk('hello')]);
    await expect(collectOpenAIStream(stream, ac.signal)).rejects.toThrow('aborted');
  });

  it('handles tokens split across chunk boundaries', async () => {
    // The SSE line is split across two network chunks
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: 'split' } }] })}\n`;
    const mid = Math.floor(line.length / 2);
    const chunks = [line.slice(0, mid), line.slice(mid), 'data: [DONE]\n'];
    const stream = makeReadableStream(chunks);
    const result = await collectOpenAIStream(stream, new AbortController().signal);
    expect(result).toBe('split');
  });
});

// ---------------------------------------------------------------------------
// anthropic.ts — collectAnthropicStream
// ---------------------------------------------------------------------------

describe('collectAnthropicStream', () => {
  function anthropicChunk(text: string): string {
    return (
      'event: content_block_delta\n' +
      `data: ${JSON.stringify({ delta: { type: 'text_delta', text } })}\n\n`
    );
  }

  it('collects text_delta events into a single string', async () => {
    const chunks = [anthropicChunk('Hello'), anthropicChunk(', world!')];
    const stream = makeReadableStream(chunks);
    const result = await collectAnthropicStream(stream, new AbortController().signal);
    expect(result).toBe('Hello, world!');
  });

  it('calls onToken for each text_delta', async () => {
    const chunks = [anthropicChunk('A'), anthropicChunk('B')];
    const stream = makeReadableStream(chunks);
    const tokens: string[] = [];
    await collectAnthropicStream(stream, new AbortController().signal, (t) => tokens.push(t));
    expect(tokens).toEqual(['A', 'B']);
  });

  it('ignores non-content_block_delta events', async () => {
    const chunks = [
      'event: message_start\ndata: {}\n\n',
      anthropicChunk('real content'),
      'event: message_delta\ndata: {}\n\n',
    ];
    const stream = makeReadableStream(chunks);
    const result = await collectAnthropicStream(stream, new AbortController().signal);
    expect(result).toBe('real content');
  });

  it('ignores malformed JSON in data lines', async () => {
    const chunks = [
      'event: content_block_delta\n',
      'data: invalid-json\n\n',
      anthropicChunk('good'),
    ];
    const stream = makeReadableStream(chunks);
    const result = await collectAnthropicStream(stream, new AbortController().signal);
    expect(result).toBe('good');
  });

  it('returns empty string for empty stream', async () => {
    const stream = makeReadableStream([]);
    const result = await collectAnthropicStream(stream, new AbortController().signal);
    expect(result).toBe('');
  });

  it('throws when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const stream = makeReadableStream([anthropicChunk('test')]);
    await expect(collectAnthropicStream(stream, ac.signal)).rejects.toThrow('aborted');
  });
});

// ---------------------------------------------------------------------------
// ibm-bob.ts — IbmBobProvider: empty baseUrl fallback
// ---------------------------------------------------------------------------

describe('IbmBobProvider: empty baseUrl fallback', () => {
  it('explain() returns template markdown + config hint when baseUrl is empty', async () => {
    const provider = new IbmBobProvider({ baseUrl: '', apiKey: 'unused' });
    const result = await provider.explain(makeInput(), new AbortController().signal);
    // Should include the template finding description
    expect(result.markdown).toContain('Bob renamed AuthResponse.userId');
    // Should include the config hint
    expect(result.markdown).toContain('IBM Bob base URL not configured');
    expect(result.fromCache).toBe(false);
  });

  it('testConnection() returns ok:false with error message when baseUrl is empty', async () => {
    const provider = new IbmBobProvider({ baseUrl: '', apiKey: 'unused' });
    const r = await provider.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not configured');
  });

  it('has id "ibm-bob"', () => {
    const provider = new IbmBobProvider({ baseUrl: '', apiKey: '' });
    expect(provider.id).toBe('ibm-bob');
  });
});

// ---------------------------------------------------------------------------
// openai-compat.ts — OpenAICompatProvider: empty baseUrl fallback
// ---------------------------------------------------------------------------

describe('OpenAICompatProvider: empty baseUrl fallback', () => {
  it('explain() returns error markdown when baseUrl is empty', async () => {
    const provider = new OpenAICompatProvider({ baseUrl: '', model: 'local' });
    const result = await provider.explain(makeInput(), new AbortController().signal);
    expect(result.markdown).toContain('interlens.llm.baseUrl');
    expect(result.fromCache).toBe(false);
  });

  it('testConnection() returns ok:false when baseUrl is empty', async () => {
    const provider = new OpenAICompatProvider({ baseUrl: '', model: 'local' });
    const r = await provider.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Base URL not configured');
  });

  it('has id "openai-compatible"', () => {
    const provider = new OpenAICompatProvider({ baseUrl: '', model: '' });
    expect(provider.id).toBe('openai-compatible');
  });
});

// ---------------------------------------------------------------------------
// llm/index.ts — createProvider factory
// ---------------------------------------------------------------------------

describe('createProvider factory', () => {
  it('creates a TemplateProvider for provider "none"', () => {
    const p = createProvider({ provider: 'none' });
    expect(p.id).toBe('none');
  });

  it('creates an OpenAIProvider for provider "openai"', () => {
    const p = createProvider({ provider: 'openai', apiKey: 'sk-test' });
    expect(p.id).toBe('openai');
  });

  it('creates an AnthropicProvider for provider "anthropic"', () => {
    const p = createProvider({ provider: 'anthropic', apiKey: 'ant-test' });
    expect(p.id).toBe('anthropic');
  });

  it('creates an OpenAICompatProvider for provider "openai-compatible"', () => {
    const p = createProvider({ provider: 'openai-compatible', baseUrl: 'http://local', model: 'm' });
    expect(p.id).toBe('openai-compatible');
  });

  it('creates an IbmBobProvider for provider "ibm-bob"', () => {
    const p = createProvider({ provider: 'ibm-bob', baseUrl: '', apiKey: '' });
    expect(p.id).toBe('ibm-bob');
  });

  it('defaults to TemplateProvider for unknown provider string', () => {
    // Cast to test the default branch
    const p = createProvider({ provider: 'unknown' as 'none' });
    expect(p.id).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// system-prompt.ts — SYSTEM_PROMPT sanity
// ---------------------------------------------------------------------------

describe('SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(10);
  });

  it('instructs for three sections', () => {
    expect(SYSTEM_PROMPT).toContain('three sections');
  });

  it('specifies a word limit', () => {
    expect(SYSTEM_PROMPT).toContain('120 words');
  });
});
