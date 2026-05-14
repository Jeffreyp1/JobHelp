import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  log,
  getRecentLogs,
  __resetForTests,
  type LogEntry,
  type LogLevel,
} from '../../core/lib/log.js';

interface StderrCapture {
  readonly lines: string[];
  restore(): void;
}

function captureStderr(): StderrCapture {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ): boolean => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    lines.push(s);
    return true;
  }) as typeof process.stderr.write);
  return {
    lines,
    restore: (): void => {
      spy.mockRestore();
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLogLevel(v: unknown): v is LogLevel {
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error';
}

function parseLine(s: string): LogEntry {
  const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s;
  const parsed: unknown = JSON.parse(trimmed);
  if (!isRecord(parsed)) throw new Error('expected object');
  const { ts, level, msg, ctx } = parsed;
  if (typeof ts !== 'string') throw new Error('bad ts');
  if (typeof msg !== 'string') throw new Error('bad msg');
  if (!isLogLevel(level)) throw new Error('bad level');
  if (ctx === undefined) {
    return { ts, level, msg };
  }
  if (!isRecord(ctx)) throw new Error('bad ctx');
  return { ts, level, msg, ctx };
}

function ctxOf(line: string | undefined): Record<string, unknown> {
  if (line === undefined) throw new Error('no line');
  const entry = parseLine(line);
  if (entry.ctx === undefined) throw new Error('expected ctx');
  return entry.ctx;
}

describe('log', () => {
  let capture: StderrCapture;
  let prevLevel: string | undefined;

  beforeEach(() => {
    __resetForTests();
    capture = captureStderr();
    prevLevel = process.env['JOBHELP_LOG_LEVEL'];
    capture.lines.length = 0;
  });

  afterEach(() => {
    capture.restore();
    if (prevLevel === undefined) {
      delete process.env['JOBHELP_LOG_LEVEL'];
    } else {
      process.env['JOBHELP_LOG_LEVEL'] = prevLevel;
    }
  });

  it('emits a JSON line with ISO timestamp, level, msg, ctx to stderr', () => {
    log('info', 'hello', { foo: 'bar' });

    expect(capture.lines).toHaveLength(1);
    const line = capture.lines[0];
    if (line === undefined) throw new Error('no line');
    expect(line.endsWith('\n')).toBe(true);

    const entry = parseLine(line);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
    expect(entry.ctx).toEqual({ foo: 'bar' });
    expect(typeof entry.ts).toBe('string');
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
  });

  it('omits ctx when not provided', () => {
    log('warn', 'no-ctx');
    const line = capture.lines[0];
    if (line === undefined) throw new Error('no line');
    const entry = parseLine(line);
    expect(entry.ctx).toBeUndefined();
    expect(entry.level).toBe('warn');
  });

  it('redacts field names matching the secret regex', () => {
    log('info', 'redact-fields', {
      apiKey: 'visible-leak',
      api_key: 'x',
      'API-KEY': 'y',
      token: 't',
      Secret: 's',
      password: 'p',
      authorization: 'Bearer abc',
      okField: 'visible',
    });
    const ctx = ctxOf(capture.lines[0]);
    expect(ctx['apiKey']).toBe('[REDACTED]');
    expect(ctx['api_key']).toBe('[REDACTED]');
    expect(ctx['API-KEY']).toBe('[REDACTED]');
    expect(ctx['token']).toBe('[REDACTED]');
    expect(ctx['Secret']).toBe('[REDACTED]');
    expect(ctx['password']).toBe('[REDACTED]');
    expect(ctx['authorization']).toBe('[REDACTED]');
    expect(ctx['okField']).toBe('visible');
  });

  it('redacts Anthropic key values to prefix...XXXX (last 4 chars)', () => {
    const prefix = 'sk' + '-ant-';
    const fullKey = prefix + 'api03-' + 'A'.repeat(30) + 'WXYZ';
    log('info', 'redact-val', { msg: `leak: ${fullKey} trailing` });
    const ctx = ctxOf(capture.lines[0]);
    const val = ctx['msg'];
    if (typeof val !== 'string') throw new Error('expected string');
    expect(val.includes(fullKey)).toBe(false);
    expect(val.includes(prefix + '...WXYZ')).toBe(true);
    expect(val.includes('leak: ')).toBe(true);
    expect(val.includes('trailing')).toBe(true);
  });

  it('truncates string values longer than 2 KB', () => {
    const big = 'x'.repeat(3000);
    log('info', 'huge', { big });
    const ctx = ctxOf(capture.lines[0]);
    const val = ctx['big'];
    if (typeof val !== 'string') throw new Error('expected string');
    expect(val.endsWith('... [TRUNCATED]')).toBe(true);
    expect(val.length).toBe(2048 + '... [TRUNCATED]'.length);
  });

  it('walks nested objects to redact secret fields recursively', () => {
    log('info', 'nested', {
      outer: { apiKey: 'leak', okField: 'visible' },
      arr: [{ password: 'p' }, 'plain'],
    });
    const ctx = ctxOf(capture.lines[0]);
    const outer = ctx['outer'];
    if (!isRecord(outer)) throw new Error('bad outer');
    expect(outer['apiKey']).toBe('[REDACTED]');
    expect(outer['okField']).toBe('visible');
    const arr = ctx['arr'];
    if (!Array.isArray(arr)) throw new Error('bad arr');
    const first = arr[0];
    if (!isRecord(first)) throw new Error('bad first');
    expect(first['password']).toBe('[REDACTED]');
    expect(arr[1]).toBe('plain');
  });

  it('debug entries emit only when JOBHELP_LOG_LEVEL=debug', () => {
    delete process.env['JOBHELP_LOG_LEVEL'];
    log('debug', 'suppressed');
    expect(capture.lines).toHaveLength(0);

    process.env['JOBHELP_LOG_LEVEL'] = 'debug';
    log('debug', 'visible');
    expect(capture.lines).toHaveLength(1);
    const line = capture.lines[0];
    if (line === undefined) throw new Error('no line');
    const entry = parseLine(line);
    expect(entry.level).toBe('debug');
  });

  it('info, warn, error always emit regardless of JOBHELP_LOG_LEVEL', () => {
    delete process.env['JOBHELP_LOG_LEVEL'];
    log('info', 'i');
    log('warn', 'w');
    log('error', 'e');
    expect(capture.lines).toHaveLength(3);
  });

  it('keeps the last 100 entries in the ring buffer; oldest dropped on overflow', () => {
    for (let i = 0; i < 150; i++) {
      log('info', `m${i}`);
    }
    const buf = getRecentLogs();
    expect(buf).toHaveLength(100);
    expect(buf[0]?.msg).toBe('m50');
    expect(buf[99]?.msg).toBe('m149');
  });

  it('getRecentLogs returns a frozen snapshot — callers cannot mutate', () => {
    log('info', 'snap');
    const buf = getRecentLogs();
    expect(Object.isFrozen(buf)).toBe(true);
    const liveBefore = getRecentLogs().length;
    expect(() => {
      Object.defineProperty(buf, 0, { value: { ts: 'x', level: 'info', msg: 'evil' } });
    }).toThrow();
    expect(getRecentLogs().length).toBe(liveBefore);
  });

  it('suppressed debug entries do NOT enter the ring buffer', () => {
    delete process.env['JOBHELP_LOG_LEVEL'];
    log('debug', 'silent');
    log('info', 'kept');
    const buf = getRecentLogs();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.msg).toBe('kept');
  });
});
