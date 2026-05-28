import type { ApiErrorResponse } from '../types/api-contract.js';
import { log } from '../lib/structuredLog.js';

function validationError(message: string): ApiErrorResponse {
  return {
    ok: false,
    error: { type: 'validation', message, retryable: false },
  };
}

const VALID_SCOPE_KINDS = ['bullet', 'section', 'role', 'whole-resume'] as const;

export function validateAutoRevise(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['currentMarkdown'] !== 'string' || (raw['currentMarkdown'] as string).length === 0) {
    log('warn', 'autoRevise validate fail: currentMarkdown missing/empty');
    return validationError('Missing or invalid required field: currentMarkdown');
  }
  if (typeof raw['instruction'] !== 'string' || (raw['instruction'] as string).length === 0) {
    log('warn', 'autoRevise validate fail: instruction missing/empty');
    return validationError('Missing or invalid required field: instruction');
  }
  if ((raw['instruction'] as string).trim().length === 0) {
    log('warn', 'autoRevise validate fail: instruction is whitespace-only');
    return validationError('instruction must be non-whitespace');
  }
  if (typeof raw['model'] !== 'string' || (raw['model'] as string).length === 0) {
    log('warn', 'autoRevise validate fail: model missing/empty');
    return validationError('Missing or invalid required field: model');
  }
  const scope = raw['targetScope'];
  if (!scope || typeof scope !== 'object') {
    log('warn', 'autoRevise validate fail: targetScope missing/not object');
    return validationError('Missing or invalid required field: targetScope');
  }
  const s = scope as Record<string, unknown>;
  const kind = s['kind'];
  if (typeof kind !== 'string' || !(VALID_SCOPE_KINDS as readonly string[]).includes(kind)) {
    log('warn', 'autoRevise validate fail: invalid scope kind', { kind: String(kind) });
    return validationError(`targetScope.kind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  if (kind === 'bullet' && (typeof s['bulletId'] !== 'string' || (s['bulletId'] as string).length === 0)) {
    return validationError('targetScope.bulletId is required for kind="bullet"');
  }
  if (kind === 'section' && (typeof s['sectionName'] !== 'string' || (s['sectionName'] as string).length === 0)) {
    return validationError('targetScope.sectionName is required for kind="section"');
  }
  if (kind === 'role' && (typeof s['companyName'] !== 'string' || (s['companyName'] as string).length === 0)) {
    return validationError('targetScope.companyName is required for kind="role"');
  }
  return null;
}
