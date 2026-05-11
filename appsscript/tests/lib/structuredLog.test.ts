/**
 * structuredLog.test.ts (Apps Script)
 *
 * Behaviour the logger MUST guarantee, end-to-end:
 *   - Secrets named in ctx keys are redacted.
 *   - Anthropic-shaped values are redacted even under "safe" keys.
 *   - Strings longer than 2 KB are truncated with a byte count.
 *   - Levels below the configured threshold are silently dropped.
 *   - Output line is valid JSON when stripped of the `[JobHelp] ` prefix.
 *
 * We replace console.log/info/warn/error via vi.spyOn so we can capture lines
 * without leaking to the real stderr/stdout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  log,
  setLogLevel,
  redactContext,
  buildEntry,
  formatEntry,
} from '../../src/lib/structuredLog';

// ---------------------------------------------------------------------------
// Console capture helper
// ---------------------------------------------------------------------------

interface Captured {
  log: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
  lines(): string[];
}

function captureConsole(): Captured {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    log,
    info,
    warn,
    error,
    lines(): string[] {
      const all = [
        ...log.mock.calls,
        ...info.mock.calls,
        ...warn.mock.calls,
        ...error.mock.calls,
      ];
      return all.map((c) => String(c[0]));
    },
  };
}

/** Strip the `[JobHelp] ` prefix and JSON.parse the rest. */
function parseLine(line: string): Record<string, unknown> {
  expect(line.startsWith('[JobHelp] ')).toBe(true);
  return JSON.parse(line.slice('[JobHelp] '.length)) as Record<string, unknown>;
}

beforeEach(() => {
  setLogLevel('debug');
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel('debug');
});

// ---------------------------------------------------------------------------
// Redaction — ctx keys
// ---------------------------------------------------------------------------

describe('redactContext', () => {
  it('redacts api_key, apiKey, x-api-key, authorization, token, secret, password', () => {
    const out = redactContext({
      api_key: 'sk-ant-foobar',
      apiKey: 'whatever',
      'x-api-key': 'leak',
      authorization: 'Bearer xyz',
      token: 'jwt.value.here',
      secret: 's3cr3t',
      password: 'hunter2',
      safe: 'ok',
    });
    expect(out).toMatchObject({
      api_key: '<redacted>',
      apiKey: '<redacted>',
      'x-api-key': '<redacted>',
      authorization: '<redacted>',
      token: '<redacted>',
      secret: '<redacted>',
      password: '<redacted>',
      safe: 'ok',
    });
  });

  it('redacts Anthropic-shaped values even under a benign key', () => {
    const out = redactContext({ greeting: 'sk-ant-abcdefghijklmnopqrstuv1234567890' });
    expect(out).toEqual({ greeting: '<redacted>' });
  });

  it('does not over-redact normal strings', () => {
    const out = redactContext({ name: 'Acme Corp', model: 'claude-haiku-4-5-20251001' });
    expect(out).toEqual({ name: 'Acme Corp', model: 'claude-haiku-4-5-20251001' });
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactContext({
      request: {
        headers: { Authorization: 'Bearer abc' },
        items: [{ token: 'leak' }, { ok: true }],
      },
    });
    expect(out).toEqual({
      request: {
        headers: { Authorization: '<redacted>' },
        items: [{ token: '<redacted>' }, { ok: true }],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('truncation', () => {
  it('truncates strings longer than 2 KB to first 200 chars + byte count', () => {
    const huge = 'x'.repeat(3000); // 3000 ASCII bytes
    const out = redactContext({ blob: huge }) as { blob: string };
    expect(out.blob.startsWith('x'.repeat(200))).toBe(true);
    expect(out.blob).toContain('<truncated,');
    expect(out.blob).toContain('more bytes>');
    // Byte count after head: 3000 - 200 = 2800
    expect(out.blob).toContain('2800 more bytes');
  });

  it('leaves strings <=2 KB untouched', () => {
    const ok = 'x'.repeat(2048);
    const out = redactContext({ blob: ok }) as { blob: string };
    expect(out.blob).toBe(ok);
  });
});

// ---------------------------------------------------------------------------
// Output format + levels
// ---------------------------------------------------------------------------

describe('log()', () => {
  it('writes a single-line JSON record with ts/level/msg/ctx', () => {
    const cap = captureConsole();
    log('info', 'hello', { foo: 'bar' });
    const lines = cap.lines();
    expect(lines.length).toBe(1);
    const parsed = parseLine(lines[0]);
    expect(parsed['level']).toBe('info');
    expect(parsed['msg']).toBe('hello');
    expect(parsed['ctx']).toEqual({ foo: 'bar' });
    expect(typeof parsed['ts']).toBe('string');
    // ISO 8601 sanity check (cheap; not a full regex)
    expect(parsed['ts']).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('uses [JobHelp] prefix so logs are grep-friendly in Apps Script', () => {
    const cap = captureConsole();
    log('info', 'x');
    expect(cap.lines()[0].startsWith('[JobHelp] ')).toBe(true);
  });

  it('routes warn/error to the correct console method', () => {
    const cap = captureConsole();
    log('warn', 'careful');
    log('error', 'broken');
    expect(cap.warn).toHaveBeenCalledTimes(1);
    expect(cap.error).toHaveBeenCalledTimes(1);
  });

  it('drops messages below the configured level', () => {
    const cap = captureConsole();
    setLogLevel('warn');
    log('debug', 'noisy');
    log('info', 'still noisy');
    log('warn', 'kept');
    log('error', 'kept');
    const lines = cap.lines();
    expect(lines.length).toBe(2);
    expect(parseLine(lines[0])['msg']).toBe('kept');
    expect(parseLine(lines[1])['msg']).toBe('kept');
  });

  it('omits ctx field when no context is supplied', () => {
    const cap = captureConsole();
    log('info', 'bare');
    const parsed = parseLine(cap.lines()[0]);
    expect('ctx' in parsed).toBe(false);
  });

  it('redacts an Anthropic key passed via ctx', () => {
    const cap = captureConsole();
    log('info', 'calling claude', {
      apiKey: 'sk-ant-abcdefghijklmnopqrstuv1234567890',
      model: 'claude-opus-4-7',
    });
    const parsed = parseLine(cap.lines()[0]);
    expect((parsed['ctx'] as Record<string, unknown>)['apiKey']).toBe('<redacted>');
    expect((parsed['ctx'] as Record<string, unknown>)['model']).toBe('claude-opus-4-7');
  });

  it('redacts a key-shaped value passed under a benign field name', () => {
    const cap = captureConsole();
    log('info', 'oops', {
      anyField: 'sk-ant-abcdefghijklmnopqrstuv1234567890',
    });
    const parsed = parseLine(cap.lines()[0]);
    expect((parsed['ctx'] as Record<string, unknown>)['anyField']).toBe('<redacted>');
  });

  it('output is valid JSON when parsed', () => {
    const cap = captureConsole();
    log('info', 'parse me', { nested: { a: 1, list: [1, 2, 3] } });
    expect(() => parseLine(cap.lines()[0])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatEntry / buildEntry primitives
// ---------------------------------------------------------------------------

describe('buildEntry + formatEntry', () => {
  it('builds an entry whose ctx is redacted', () => {
    const e = buildEntry('warn', 'msg', { token: 'leak' });
    expect(e.ctx).toEqual({ token: '<redacted>' });
    expect(e.level).toBe('warn');
    expect(e.msg).toBe('msg');
  });

  it('formats an entry as a [JobHelp]-prefixed line', () => {
    const line = formatEntry({ ts: '2026-05-11T00:00:00Z', level: 'info', msg: 'x' });
    expect(line.startsWith('[JobHelp] ')).toBe(true);
    expect(JSON.parse(line.slice('[JobHelp] '.length))).toEqual({
      ts: '2026-05-11T00:00:00Z',
      level: 'info',
      msg: 'x',
    });
  });
});
