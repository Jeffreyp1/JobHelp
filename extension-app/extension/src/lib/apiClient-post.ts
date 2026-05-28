import { log } from './structuredLog.js';
import type { ApiError } from '../types/api-contract.js';

function networkError(message: string): { ok: false; error: ApiError } {
  return {
    ok: false,
    error: {
      type: 'server',
      message,
      retryable: true,
    },
  };
}

function headSnippet(s: string, n = 200): string {
  return s.slice(0, n).replace(/\s+/g, ' ').trim();
}

export async function postToAppsScript<T>(
  appsScriptUrl: string,
  body: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Network request failed';
    log('warn', 'apiClient: network request failed', {
      action: body.action,
      error: message,
    });
    return networkError(message) as T;
  }

  if (!response.ok) {
    log('warn', 'apiClient: HTTP error response', {
      action: body.action,
      status: response.status,
      statusText: response.statusText,
    });
    return networkError(`HTTP ${response.status}: ${response.statusText}`) as T;
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to read response body';
    log('error', 'apiClient: failed to read response body', {
      action: body.action,
      error: message,
    });
    return networkError(message) as T;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const snippet = headSnippet(rawText);
    log('error', 'apiClient: response was not valid JSON', {
      action: body.action,
      bodySnippet: snippet,
    });
    return networkError(`Response was not valid JSON: ${snippet}`) as T;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { ok?: unknown }).ok !== 'boolean'
  ) {
    const snippet = headSnippet(rawText);
    log('error', 'apiClient: malformed response — missing ok flag', {
      action: body.action,
      bodySnippet: snippet,
    });
    return networkError(`Malformed response — missing ok flag: ${snippet}`) as T;
  }

  return parsed as T;
}
