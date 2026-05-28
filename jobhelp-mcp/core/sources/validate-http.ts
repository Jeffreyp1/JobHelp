import { classifyHttpStatus } from './_shared.js';
import type { SourceValidationError } from './validate.js';

export interface PingOutcome {
  readonly ok: boolean;
  readonly jobCount?: number;
  readonly statusCode?: number;
  readonly error?: SourceValidationError;
}

export function networkError(message: string): SourceValidationError {
  return { type: 'network', message };
}

export async function safeFetch(url: string, init?: RequestInit): Promise<Response | SourceValidationError> {
  try {
    return await fetch(url, init);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return networkError(msg);
  }
}

export async function readBody(response: Response): Promise<{ ok: true; body: unknown } | SourceValidationError> {
  let text: string;
  try {
    text = await response.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'body read failed';
    return networkError(msg);
  }
  if (text.length === 0) {
    return { type: 'parse', message: 'empty body' };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { type: 'parse', message: 'response was not valid JSON' };
  }
}

export function statusToError(status: number, source: string): SourceValidationError {
  return { type: classifyHttpStatus(status), message: `${source} HTTP ${status}` };
}
