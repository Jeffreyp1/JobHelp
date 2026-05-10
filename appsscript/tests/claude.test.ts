import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callClaude, ClaudeApiError } from '../src/claude';
import { composeSystemPrompt } from '../src/prompt';
import { estimateTokens } from '../src/tokens';
import type { ClaudeRequest, ClaudeResponse } from '../src/types/claude-api';
import type { FileEntry } from '../src/types/drive-ops';

// ---------------------------------------------------------------------------
// Mock builders for UrlFetchApp and PropertiesService
// ---------------------------------------------------------------------------

interface CapturedFetch {
  url: string;
  options: {
    method?: string;
    headers?: Record<string, string>;
    payload?: string;
    contentType?: string;
    muteHttpExceptions?: boolean;
  };
}

function makeFetchApp(response: { status: number; body: string }): {
  fetch: (url: string, options?: CapturedFetch['options']) => {
    getResponseCode(): number;
    getContentText(): string;
  };
  captured: CapturedFetch[];
} {
  const captured: CapturedFetch[] = [];
  return {
    captured,
    fetch: (url: string, options: CapturedFetch['options'] = {}) => {
      captured.push({ url, options });
      return {
        getResponseCode: () => response.status,
        getContentText: () => response.body,
      };
    },
  };
}

function makePropertiesService(apiKey: string | null): {
  getScriptProperties: () => { getProperty(key: string): string | null };
} {
  return {
    getScriptProperties: () => ({
      getProperty: (key: string) => (key === 'ANTHROPIC_API_KEY' ? apiKey : null),
    }),
  };
}

function makeRequest(overrides: Partial<ClaudeRequest> = {}): ClaudeRequest {
  return {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    system: [
      {
        type: 'text',
        text: 'You are a helpful resume assistant.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

const SUCCESS_BODY = JSON.stringify({
  id: 'msg_123',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5-20251001',
  content: [{ type: 'text', text: 'Hi there!' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 12,
    output_tokens: 5,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 0,
  },
});

beforeEach(() => {
  vi.stubGlobal('PropertiesService', makePropertiesService('test-api-key'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// callClaude
// ---------------------------------------------------------------------------

describe('callClaude', () => {
  it('T1: builds correct request body with system as array (for prompt caching)', () => {
    const fetchApp = makeFetchApp({ status: 200, body: SUCCESS_BODY });
    vi.stubGlobal('UrlFetchApp', fetchApp);

    callClaude(makeRequest());

    expect(fetchApp.captured.length).toBe(1);
    const call = fetchApp.captured[0];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.options.method).toBe('post');
    const body = JSON.parse(call.options.payload!);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system.length).toBe(1);
    expect(body.system[0].type).toBe('text');
    expect(body.system[0].text).toBe('You are a helpful resume assistant.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('T2: includes cache_control: { type: "ephemeral" } on system block', () => {
    const fetchApp = makeFetchApp({ status: 200, body: SUCCESS_BODY });
    vi.stubGlobal('UrlFetchApp', fetchApp);

    callClaude(makeRequest());

    const body = JSON.parse(fetchApp.captured[0].options.payload!);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    // Headers should include API key + version
    const headers = fetchApp.captured[0].options.headers ?? {};
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('T3: returns parsed { text, stopReason, usage } on 200', () => {
    const fetchApp = makeFetchApp({ status: 200, body: SUCCESS_BODY });
    vi.stubGlobal('UrlFetchApp', fetchApp);

    const resp: ClaudeResponse = callClaude(makeRequest());

    expect(resp.text).toBe('Hi there!');
    expect(resp.stopReason).toBe('end_turn');
    expect(resp.usage.input_tokens).toBe(12);
    expect(resp.usage.output_tokens).toBe(5);
    expect(resp.usage.cache_creation_input_tokens).toBe(100);
    expect(resp.usage.cache_read_input_tokens).toBe(0);
    expect(resp.model).toBe('claude-haiku-4-5-20251001');
  });

  it('T4: throws ClaudeApiError type "auth" on 401', () => {
    const errorBody = JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    vi.stubGlobal('UrlFetchApp', makeFetchApp({ status: 401, body: errorBody }));

    let thrown: unknown = null;
    try {
      callClaude(makeRequest());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaudeApiError);
    const err = thrown as ClaudeApiError;
    expect(err.errorType).toBe('auth');
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('T5: throws ClaudeApiError type "rate_limit" on 429 with retryAfterSeconds', () => {
    const errorBody = JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Too many requests' },
    });
    const fetchApp = makeFetchApp({ status: 429, body: errorBody });
    // Override fetch to also include retry-after header detection through body parse
    // Implementation should parse retry-after from "retry-after" header surfaced via getAllHeaders
    // but Apps Script UrlFetchApp returns only response code/text — so retryAfterSeconds is parsed
    // from the JSON error body if available, else defaulted.
    vi.stubGlobal('UrlFetchApp', fetchApp);

    let thrown: unknown = null;
    try {
      callClaude(makeRequest());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaudeApiError);
    const err = thrown as ClaudeApiError;
    expect(err.errorType).toBe('rate_limit');
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
    expect(typeof err.retryAfterSeconds).toBe('number');
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('T6: throws ClaudeApiError type "server" on 5xx', () => {
    const errorBody = JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: 'Internal server error' },
    });
    vi.stubGlobal('UrlFetchApp', makeFetchApp({ status: 500, body: errorBody }));

    let thrown: unknown = null;
    try {
      callClaude(makeRequest());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaudeApiError);
    const err = thrown as ClaudeApiError;
    expect(err.errorType).toBe('server');
    expect(err.statusCode).toBe(500);
    expect(err.retryable).toBe(true);
  });

  it('T7: throws ClaudeApiError type "validation" on 400', () => {
    const errorBody = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'max_tokens too large' },
    });
    vi.stubGlobal('UrlFetchApp', makeFetchApp({ status: 400, body: errorBody }));

    let thrown: unknown = null;
    try {
      callClaude(makeRequest());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaudeApiError);
    const err = thrown as ClaudeApiError;
    expect(err.errorType).toBe('validation');
    expect(err.statusCode).toBe(400);
    expect(err.retryable).toBe(false);
  });

  it('T8: handles content array with multiple text blocks (concatenates them)', () => {
    const body = JSON.stringify({
      id: 'msg_456',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5-20251001',
      content: [
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two. ' },
        { type: 'text', text: 'Part three.' },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 5,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    vi.stubGlobal('UrlFetchApp', makeFetchApp({ status: 200, body }));

    const resp = callClaude(makeRequest());
    expect(resp.text).toBe('Part one. Part two. Part three.');
  });

  it('T9: respects model parameter (uses what is passed, does not substitute)', () => {
    const fetchApp = makeFetchApp({ status: 200, body: SUCCESS_BODY });
    vi.stubGlobal('UrlFetchApp', fetchApp);

    callClaude(makeRequest({ model: 'claude-opus-4-7-20251015' }));

    const sent = JSON.parse(fetchApp.captured[0].options.payload!);
    expect(sent.model).toBe('claude-opus-4-7-20251015');
  });

  it('T10: respects maxTokens parameter', () => {
    const fetchApp = makeFetchApp({ status: 200, body: SUCCESS_BODY });
    vi.stubGlobal('UrlFetchApp', fetchApp);

    callClaude(makeRequest({ maxTokens: 8192 }));

    const sent = JSON.parse(fetchApp.captured[0].options.payload!);
    expect(sent.max_tokens).toBe(8192);
  });
});

// ---------------------------------------------------------------------------
// composeSystemPrompt
// ---------------------------------------------------------------------------

function makeFile(name: string, contents: string, fileId = `id-${name}`): FileEntry {
  return {
    name,
    fileId,
    contents,
    tokens: Math.ceil(contents.length / 4),
    lastModifiedAt: 1_700_000_000_000,
  };
}

describe('composeSystemPrompt', () => {
  it('T11: concatenates rule files in alphanumeric order', () => {
    const files: FileEntry[] = [
      makeFile('03-c.md', 'C contents'),
      makeFile('01-a.md', 'A contents'),
      makeFile('02-b.md', 'B contents'),
    ];
    const block = composeSystemPrompt(files);
    const aIdx = block.text.indexOf('A contents');
    const bIdx = block.text.indexOf('B contents');
    const cIdx = block.text.indexOf('C contents');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
  });

  it('T12: separates files with --- markers', () => {
    const files: FileEntry[] = [
      makeFile('01-first.md', 'First body'),
      makeFile('02-second.md', 'Second body'),
    ];
    const block = composeSystemPrompt(files);
    // There should be at least one --- separator between files
    const sepCount = (block.text.match(/\n---\n/g) ?? []).length;
    expect(sepCount).toBeGreaterThanOrEqual(1);
    // Separator must appear between First body and Second body
    const firstIdx = block.text.indexOf('First body');
    const secondIdx = block.text.indexOf('Second body');
    const sepIdx = block.text.indexOf('\n---\n', firstIdx);
    expect(sepIdx).toBeGreaterThan(firstIdx);
    expect(sepIdx).toBeLessThan(secondIdx);
  });

  it('T13: includes file id headers (e.g., "## 01-priority-hierarchy.md")', () => {
    const files: FileEntry[] = [
      makeFile('01-priority-hierarchy.md', 'priority body'),
      makeFile('02-anti-fabrication.md', 'fab body'),
    ];
    const block = composeSystemPrompt(files);
    expect(block.text).toContain('## 01-priority-hierarchy.md');
    expect(block.text).toContain('## 02-anti-fabrication.md');
  });

  it('T14: handles empty rule file array (returns empty string or sane default)', () => {
    const block = composeSystemPrompt([]);
    expect(block.type).toBe('text');
    expect(typeof block.text).toBe('string');
    // Whatever the default is, must be a valid SystemBlock (text could be empty
    // or a generic instruction). The key invariant: doesn't crash.
    expect(block.text.length).toBeGreaterThanOrEqual(0);
  });

  it('T15: outputs single SystemBlock with cache_control set', () => {
    const files: FileEntry[] = [makeFile('01-a.md', 'A')];
    const block = composeSystemPrompt(files);
    expect(block.type).toBe('text');
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('T16: returns within 15% of actual for English ASCII text', () => {
    // For English ASCII, the rough rule is chars/4 ≈ tokens.
    // We use that as our "actual" reference and assert estimateTokens is within 15%.
    const samples = [
      'a'.repeat(50),
      'The quick brown fox jumps over the lazy dog. '.repeat(5).slice(0, 200),
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10).slice(0, 500),
      'A'.repeat(2000),
      'B'.repeat(5000),
    ];
    for (const s of samples) {
      const expected = s.length / 4;
      const actual = estimateTokens(s);
      const diff = Math.abs(actual - expected);
      const pct = diff / expected;
      expect(pct, `expected ${expected} tokens, got ${actual} for length ${s.length}`).toBeLessThanOrEqual(
        0.15,
      );
    }
  });

  it('T17: monotonic — longer text returns >= shorter text', () => {
    const a = estimateTokens('hello');
    const b = estimateTokens('hello world');
    const c = estimateTokens('hello world this is a longer string');
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });

  it('T18: handles empty string (returns 0)', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('T19: handles unicode/emoji (rough approximation OK)', () => {
    // No crash; returns a positive integer.
    const t1 = estimateTokens('日本語のテキスト');
    const t2 = estimateTokens('emoji time');
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBeGreaterThan(0);
    expect(Number.isFinite(t1)).toBe(true);
    expect(Number.isInteger(t1)).toBe(true);
  });
});
