export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly ctx?: LogContext;
}

const RING_SIZE = 100;
const TRUNCATE_LIMIT = 2048;
const TRUNCATE_SUFFIX = '... [TRUNCATED]';
const REDACTED = '[REDACTED]';
const KEY_NAME_RE = /api[-_]?key|token|secret|password|authorization/i;
const ANTHROPIC_KEY_RE = new RegExp('sk' + '-ant-' + '[a-zA-Z0-9_-]{20,}', 'g');

const ring: LogEntry[] = [];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function maskSecretsInString(s: string): string {
  let out = s.replace(ANTHROPIC_KEY_RE, (m) => 'sk' + '-ant-...' + m.slice(-4));
  if (out.length > TRUNCATE_LIMIT) {
    out = out.slice(0, TRUNCATE_LIMIT) + TRUNCATE_SUFFIX;
  }
  return out;
}

function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return maskSecretsInString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (isPlainObject(v)) return redactCtx(v);
  return v;
}

function redactCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (KEY_NAME_RE.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

function shouldEmit(level: LogLevel): boolean {
  if (level !== 'debug') return true;
  return process.env['JOBHELP_LOG_LEVEL'] === 'debug';
}

function pushRing(entry: LogEntry): void {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
}

export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (!shouldEmit(level)) return;
  const ts = new Date().toISOString();
  const redactedCtx = ctx !== undefined ? redactCtx(ctx) : undefined;
  const entry: LogEntry =
    redactedCtx !== undefined
      ? { ts, level, msg, ctx: redactedCtx }
      : { ts, level, msg };
  pushRing(entry);
  const payload: Record<string, unknown> = { ts, level, msg };
  if (redactedCtx !== undefined) payload['ctx'] = redactedCtx;
  process.stderr.write(JSON.stringify(payload) + '\n');
}

export function getRecentLogs(): readonly LogEntry[] {
  return Object.freeze(ring.slice());
}

export function __resetForTests(): void {
  ring.length = 0;
}
