/**
 * structuredLog.test.ts (extension)
 *
 * Tests for the extension-side structured logger. Adds ring-buffer coverage
 * on top of the same redaction / level / format guarantees the Apps Script
 * version has.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  log,
  setLogLevel,
  redactContext,
  buildEntry,
  formatEntry,
  getRecentLogs,
  clearRecentLogs,
} from '../../src/lib/structuredLog';

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

function parseLine(line: string): Record<string, unknown> {
  expect(line.startsWith('[JobHelp] ')).toBe(true);
  return JSON.parse(line.slice('[JobHelp] '.length)) as Record<string, unknown>;
}

beforeEach(() => {
  setLogLevel('debug');
  clearRecentLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel('debug');
  clearRecentLogs();
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redactContext', () => {
  it('redacts secret-named keys', () => {
    const out = redactContext({
      api_key: 'x',
      apiKey: 'x',
      'x-api-key': 'x',
      authorization: 'Bearer y',
      token: 'jwt',
      secret: 's',
      password: 'p',
      ok: 'fine',
    });
    expect(out).toMatchObject({
      api_key: '<redacted>',
      apiKey: '<redacted>',
      'x-api-key': '<redacted>',
      authorization: '<redacted>',
      token: '<redacted>',
      secret: '<redacted>',
      password: '<redacted>',
      ok: 'fine',
    });
  });

  it('redacts Anthropic-shaped values regardless of key name', () => {
    const out = redactContext({
      whatever: 'sk-ant-abcdefghijklmnopqrstuv1234567890',
    });
    expect(out).toEqual({ whatever: '<redacted>' });
  });

  it('recurses through nested objects + arrays', () => {
    const out = redactContext({
      headers: { Authorization: 'Bearer abc' },
      payload: [{ token: 't' }, { keep: 'me' }],
    });
    expect(out).toEqual({
      headers: { Authorization: '<redacted>' },
      payload: [{ token: '<redacted>' }, { keep: 'me' }],
    });
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('truncation', () => {
  it('truncates strings >2 KB and records remaining byte count', () => {
    const huge = 'x'.repeat(3000);
    const out = redactContext({ blob: huge }) as { blob: string };
    expect(out.blob.startsWith('x'.repeat(200))).toBe(true);
    expect(out.blob).toContain('<truncated,');
    expect(out.blob).toContain('2800 more bytes');
  });

  it('does not touch strings at or below 2 KB', () => {
    const ok = 'x'.repeat(2048);
    const out = redactContext({ blob: ok }) as { blob: string };
    expect(out.blob).toBe(ok);
  });
});

// ---------------------------------------------------------------------------
// Output + levels
// ---------------------------------------------------------------------------

describe('log()', () => {
  it('emits single-line JSON with ts/level/msg/ctx prefixed by [JobHelp]', () => {
    const cap = captureConsole();
    log('info', 'hi', { foo: 'bar' });
    const parsed = parseLine(cap.lines()[0]);
    expect(parsed['level']).toBe('info');
    expect(parsed['msg']).toBe('hi');
    expect(parsed['ctx']).toEqual({ foo: 'bar' });
    expect(parsed['ts']).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('redacts api key from ctx', () => {
    const cap = captureConsole();
    log('info', 'call', { apiKey: 'whatever' });
    const parsed = parseLine(cap.lines()[0]);
    expect((parsed['ctx'] as Record<string, unknown>)['apiKey']).toBe('<redacted>');
  });

  it('redacts Anthropic-shaped value inside a benign field', () => {
    const cap = captureConsole();
    log('info', 'leak?', { greeting: 'sk-ant-abcdefghijklmnopqrstuv1234567890' });
    const parsed = parseLine(cap.lines()[0]);
    expect((parsed['ctx'] as Record<string, unknown>)['greeting']).toBe('<redacted>');
  });

  it('redacts authorization header in ctx', () => {
    const cap = captureConsole();
    log('warn', 'req', {
      headers: { Authorization: 'Bearer foobar', 'x-api-key': 'leak' },
    });
    const parsed = parseLine(cap.lines()[0]);
    const headers = (parsed['ctx'] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('<redacted>');
    expect(headers['x-api-key']).toBe('<redacted>');
  });

  it('routes warn/error to the right console method', () => {
    const cap = captureConsole();
    log('warn', 'a');
    log('error', 'b');
    expect(cap.warn).toHaveBeenCalledTimes(1);
    expect(cap.error).toHaveBeenCalledTimes(1);
  });

  it('drops messages below the configured level', () => {
    const cap = captureConsole();
    setLogLevel('warn');
    log('debug', 'no');
    log('info', 'no');
    log('warn', 'yes');
    log('error', 'yes');
    expect(cap.lines().length).toBe(2);
  });

  it('output is valid JSON', () => {
    const cap = captureConsole();
    log('info', 'parse', { nested: { items: [1, 2, { token: 't' }] } });
    expect(() => parseLine(cap.lines()[0])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

describe('getRecentLogs', () => {
  it('returns entries in chronological order', () => {
    captureConsole();
    log('info', 'first');
    log('info', 'second');
    log('info', 'third');
    const recent = getRecentLogs();
    expect(recent.map((e) => e.msg)).toEqual(['first', 'second', 'third']);
  });

  it('keeps exactly the last 100 entries when more are written', () => {
    captureConsole();
    for (let i = 0; i < 150; i++) {
      log('info', `m${i}`);
    }
    const recent = getRecentLogs();
    expect(recent.length).toBe(100);
    expect(recent[0].msg).toBe('m50');   // 150 written, oldest 50 evicted
    expect(recent[99].msg).toBe('m149');
  });

  it('captures entries even when level is filtered for console output', () => {
    const cap = captureConsole();
    setLogLevel('error');
    log('debug', 'hidden');
    log('info',  'hidden too');
    expect(cap.lines().length).toBe(0);
    expect(getRecentLogs().map((e) => e.msg)).toEqual(['hidden', 'hidden too']);
  });

  it('returns redacted ctx in the ring (no secrets leak via debug surface)', () => {
    captureConsole();
    log('info', 'r', { apiKey: 'leak', token: 't', plain: 'ok' });
    const recent = getRecentLogs();
    expect(recent[0].ctx).toEqual({ apiKey: '<redacted>', token: '<redacted>', plain: 'ok' });
  });

  it('returns a defensive copy — mutating the result does not affect the buffer', () => {
    captureConsole();
    log('info', 'a');
    const copy = getRecentLogs();
    copy.length = 0;
    expect(getRecentLogs().length).toBe(1);
  });

  it('clearRecentLogs empties the buffer', () => {
    captureConsole();
    log('info', 'a');
    log('info', 'b');
    clearRecentLogs();
    expect(getRecentLogs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('buildEntry + formatEntry', () => {
  it('buildEntry returns a redacted entry with iso timestamp', () => {
    const e = buildEntry('warn', 'msg', { secret: 's' });
    expect(e.level).toBe('warn');
    expect(e.msg).toBe('msg');
    expect(e.ctx).toEqual({ secret: '<redacted>' });
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('formatEntry produces a [JobHelp]-prefixed valid JSON line', () => {
    const line = formatEntry({ ts: '2026-05-11T00:00:00Z', level: 'info', msg: 'x' });
    expect(line.startsWith('[JobHelp] ')).toBe(true);
    expect(JSON.parse(line.slice('[JobHelp] '.length))).toEqual({
      ts: '2026-05-11T00:00:00Z',
      level: 'info',
      msg: 'x',
    });
  });
});
