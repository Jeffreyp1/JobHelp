/**
 * structuredLog.ts (Apps Script)
 *
 * Single-line JSON structured logger for the JobHelp Apps Script backend.
 *
 * Goals:
 *   - Emit grep-friendly, machine-parseable lines in Apps Script's "Executions"
 *     log so failures can be triaged without re-running the request.
 *   - Redact obvious secrets before they ever reach the log:
 *       * keys whose name matches /api[-_]?key|token|secret|password|authorization|x-api-key/i
 *       * any string value that looks like an Anthropic API key
 *         (^sk-ant-[A-Za-z0-9_-]{20,}$)
 *   - Truncate huge string values (>2 KB) so a single bad payload doesn't blow
 *     past Apps Script's per-execution log buffer.
 *
 * This module deliberately uses ONLY Apps Script V8 builtins (console.*,
 * JSON, Date) — no Node APIs — so it bundles cleanly with esbuild's GAS build.
 *
 * Wiring this into existing call sites is intentionally NOT done here; that's
 * follow-up work. This file just gives the codebase a primitive to reach for.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Inclusive minimum level that will be emitted. Anything below is dropped. */
let minLevel: LogLevel = 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Set the minimum log level. Useful for noisy debug paths in tests. */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/** Returns the current minimum level — exported for tests. */
export function getLogLevel(): LogLevel {
  return minLevel;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Context keys that should always be redacted regardless of value shape. */
const SECRET_KEY_RE = /api[-_]?key|token|secret|password|authorization|x-api-key/i;

/** Values that look like Anthropic API keys are scrubbed even under "safe" keys. */
const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/** Strings longer than this are truncated. 2 KB matches the brief. */
const MAX_STRING_BYTES = 2048;

/** Maximum recursion depth for redaction — protects against cyclic refs. */
const MAX_REDACT_DEPTH = 6;

/** Compute UTF-8 byte length (Apps Script V8 supports Blob, but Utilities.newBlob
 *  is overkill for length checks; fall back to a per-char codepoint estimate). */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — counted as part of a 4-byte sequence below.
      bytes += 4;
      i++; // skip the paired low surrogate
    } else bytes += 3;
  }
  return bytes;
}

/** Truncate a string to 200 chars + a "<truncated, N more bytes>" tail. */
function truncateLongString(s: string): string {
  const totalBytes = utf8ByteLength(s);
  if (totalBytes <= MAX_STRING_BYTES) return s;
  const head = s.slice(0, 200);
  const remaining = totalBytes - utf8ByteLength(head);
  return `${head} ... <truncated, ${remaining} more bytes>`;
}

/**
 * Recursively redact a value. Returns a new structure — never mutates input.
 * - Strings matching ANTHROPIC_KEY_RE → '<redacted>'
 * - Strings >2 KB → truncated with byte count
 * - Objects: keys matching SECRET_KEY_RE → '<redacted>'; others recursed into
 * - Arrays recursed element-wise.
 */
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
  // Functions, symbols, bigints: convert to string and re-run the string path.
  try {
    return String(value);
  } catch {
    return '<unserialisable>';
  }
}

/** Public-facing redactor (depth-0 entry point). */
export function redactContext(ctx: LogContext | undefined): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  return redact(ctx, 0) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: Record<string, unknown>;
}

/** Build the entry record without emitting — useful for tests. */
export function buildEntry(level: LogLevel, msg: string, ctx?: LogContext): LogEntry {
  const ts = new Date().toISOString();
  const redacted = redactContext(ctx);
  const entry: LogEntry = { ts, level, msg };
  if (redacted !== undefined) entry.ctx = redacted;
  return entry;
}

/**
 * Serialise an entry to the on-the-wire string. Always single-line JSON
 * prefixed with `[JobHelp]` so Apps Script log filters can pick it up.
 */
export function formatEntry(entry: LogEntry): string {
  let body: string;
  try {
    body = JSON.stringify(entry);
  } catch {
    // Cyclic ref or other JSON failure — emit a minimal fallback so we don't
    // throw out of a logger.
    body = JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      msg: entry.msg,
      ctx: { _logError: 'JSON.stringify failed' },
    });
  }
  return `[JobHelp] ${body}`;
}

/** Map a LogLevel to the appropriate console.* method. */
function consoleFor(level: LogLevel): (msg: string) => void {
  // Apps Script implements console.log/.info/.warn/.error. We bind to globalThis
  // so tests can stub a different console object onto globalThis if needed.
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

/**
 * Emit a structured log line.
 *
 * @param level  'debug' | 'info' | 'warn' | 'error'
 * @param msg    short human-readable message
 * @param ctx    optional context bag (will be redacted before emitting)
 */
export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const entry = buildEntry(level, msg, ctx);
  const line = formatEntry(entry);
  consoleFor(level)(line);
}

// ---------------------------------------------------------------------------
// Convenience helpers (1-line per level)
// ---------------------------------------------------------------------------

export function debug(msg: string, ctx?: LogContext): void { log('debug', msg, ctx); }
export function info(msg: string, ctx?: LogContext): void  { log('info',  msg, ctx); }
export function warn(msg: string, ctx?: LogContext): void  { log('warn',  msg, ctx); }
export function error(msg: string, ctx?: LogContext): void { log('error', msg, ctx); }
