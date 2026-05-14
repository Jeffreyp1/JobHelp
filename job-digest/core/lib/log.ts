/**
 * Log level. `info` = milestones; `debug` = chatter; `warn` = recoverable; `error` = broken flow.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured context. Values are redacted for secrets and truncated when >2 KB. */
export type LogContext = Record<string, unknown>;

export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly ctx?: LogContext;
}

/**
 * Emit a structured log entry. Auto-redacts API keys and truncates >2 KB values.
 *
 * @param level - severity
 * @param msg - human-readable message
 * @param ctx - structured context (optional)
 */
export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  // STUB body — Agent D owns the real implementation.
  // No-op so other agents' code can call log() without throwing during their tests.
  void level;
  void msg;
  void ctx;
}

/**
 * Get the in-memory ring buffer of recent log entries. For test inspection only.
 */
export function getRecentLogs(): readonly LogEntry[] {
  // STUB body — Agent D owns the real implementation.
  return [];
}
