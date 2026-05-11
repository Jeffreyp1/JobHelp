/**
 * structuredLog.ts (extension)
 *
 * Single-line JSON structured logger for the JobHelp Chrome extension.
 *
 * Mirrors the Apps Script logger in appsscript/src/lib/structuredLog.ts but
 * also exposes an in-memory ring buffer (last 100 entries) so a future
 * "Debug log" UI surface can show recent activity without re-running any
 * action. Both versions share the same redaction rules:
 *
 *   - keys matching /api[-_]?key|token|secret|password|authorization|x-api-key/i
 *     are replaced with '<redacted>'
 *   - string values matching the Anthropic API key pattern
 *     (^sk-ant-[A-Za-z0-9_-]{20,}$) are replaced with '<redacted>'
 *   - any string >2 KB is truncated to the first 200 chars +
 *     ` ... <truncated, N more bytes>`
 *
 * Output: `[JobHelp] <single-line JSON>` to console.log/info/warn/error.
 *
 * Wiring this into existing call sites is intentionally NOT done here — that's
 * follow-up work. This file just gives the codebase a primitive to reach for.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let minLevel: LogLevel = 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_KEY_RE = /api[-_]?key|token|secret|password|authorization|x-api-key/i;
const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const MAX_STRING_BYTES = 2048;
const MAX_REDACT_DEPTH = 6;

function utf8ByteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  // Fallback codepoint estimator (matches the Apps Script implementation).
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function truncateLongString(s: string): string {
  const totalBytes = utf8ByteLength(s);
  if (totalBytes <= MAX_STRING_BYTES) return s;
  const head = s.slice(0, 200);
  const remaining = totalBytes - utf8ByteLength(head);
  return `${head} ... <truncated, ${remaining} more bytes>`;
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH) return '<max-depth>';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    if (ANTHROPIC_KEY_RE.test(s)) return '<redacted>';
    return truncateLongString(s);
  }
  if (t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = '<redacted>';
      } else {
        out[key] = redact((value as Record<string, unknown>)[key], depth + 1);
      }
    }
    return out;
  }
  try {
    return String(value);
  } catch {
    return '<unserialisable>';
  }
}

export function redactContext(
  ctx: LogContext | undefined,
): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  return redact(ctx, 0) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const RING_CAPACITY = 100;
const ring: LogEntry[] = [];

/**
 * Return up to the last 100 entries in chronological order (oldest first).
 *
 * Used by future debug UIs (e.g. a Settings → "View recent log" surface) so
 * users can grab a copy without re-running the failing flow.
 */
export function getRecentLogs(): LogEntry[] {
  // Return a defensive copy — callers shouldn't be able to mutate our buffer.
  return ring.slice();
}

/** Clear the ring buffer. Intended for tests. */
export function clearRecentLogs(): void {
  ring.length = 0;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function buildEntry(level: LogLevel, msg: string, ctx?: LogContext): LogEntry {
  const ts = new Date().toISOString();
  const redacted = redactContext(ctx);
  const entry: LogEntry = { ts, level, msg };
  if (redacted !== undefined) entry.ctx = redacted;
  return entry;
}

export function formatEntry(entry: LogEntry): string {
  let body: string;
  try {
    body = JSON.stringify(entry);
  } catch {
    body = JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      msg: entry.msg,
      ctx: { _logError: 'JSON.stringify failed' },
    });
  }
  return `[JobHelp] ${body}`;
}

function consoleFor(level: LogLevel): (msg: string) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).console ?? console;
  switch (level) {
    case 'debug':
      return (c.log ?? c.info ?? c.warn).bind(c);
    case 'info':
      return (c.info ?? c.log).bind(c);
    case 'warn':
      return (c.warn ?? c.log).bind(c);
    case 'error':
      return (c.error ?? c.log).bind(c);
  }
}

function pushRing(entry: LogEntry): void {
  ring.push(entry);
  while (ring.length > RING_CAPACITY) ring.shift();
}

/**
 * Emit a structured log line.
 *
 * Always pushes to the ring buffer (even when filtered below minLevel) so the
 * debug UI can still surface low-level activity once enabled. Console output
 * is gated by minLevel.
 */
export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  const entry = buildEntry(level, msg, ctx);
  pushRing(entry);
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const line = formatEntry(entry);
  consoleFor(level)(line);
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function debug(msg: string, ctx?: LogContext): void { log('debug', msg, ctx); }
export function info(msg: string, ctx?: LogContext): void  { log('info',  msg, ctx); }
export function warn(msg: string, ctx?: LogContext): void  { log('warn',  msg, ctx); }
export function error(msg: string, ctx?: LogContext): void { log('error', msg, ctx); }
