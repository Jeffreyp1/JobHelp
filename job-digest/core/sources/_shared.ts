import type { RemoteMode } from '../types/job.js';
import type { SourceErrorType } from '../types/source.js';

/**
 * Typed transport error raised by source adapters when a fetch fails.
 * The .type field maps to SourceErrorType for orchestrator classification.
 */
export class SourceFetchError extends Error {
  readonly type: SourceErrorType;
  constructor(type: SourceErrorType, message: string) {
    super(message);
    this.name = 'SourceFetchError';
    this.type = type;
  }
}

export function classifyHttpStatus(status: number): SourceErrorType {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return 'unknown';
}

export function detectRemoteMode(text: string): RemoteMode {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(remote|wfh|work[- ]from[- ]home)\b/.test(t)) return 'remote';
  if (/\b(on[- ]?site|in[- ]office)\b/.test(t)) return 'onsite';
  return 'unknown';
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asIsoString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
