/**
 * @file handlers/extractProfile.ts
 *
 * Feature: Extract Profile (action: "extract_profile")
 * Owner agent: J4 — Phase 1 job-pipeline handlers
 *
 * Behaviour:
 *   - Validates inputs (sourceFolderId, model required, both non-empty strings)
 *   - Reads source materials from Drive (deps.drive.readSourceFiles)
 *   - Distils them into a JobProfile via one Claude call (distilProfile)
 *   - Returns { profile, cost } as ExtractProfileResult
 *   - log() on entry/exit (every path) — NO silent failures
 *   - All error paths return ApiResult<never> with ok:false — never throws
 *   - ClaudeApiError → forwarded errorType + retryable
 *   - Drive read failure → driveError (type:"drive", retryable:false)
 *   - Any other thrown Error → type:"server", retryable:true
 */

import type { Deps } from '../Code.js';
import type {
  ExtractProfileRequest,
  ExtractProfileResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { distilProfile } from '../lib/jobProfile.js';
import { log } from '../lib/structuredLog.js';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

function driveError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'drive', message, retryable: false } };
}

/**
 * Validate a raw request body for the "extract_profile" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateExtractProfile(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['sourceFolderId'] !== 'string' || raw['sourceFolderId'].length === 0) {
    return validationError('Missing or invalid required field: sourceFolderId');
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    return validationError('Missing or invalid required field: model');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle an "extract_profile" request.
 * Always returns ApiResult<ExtractProfileResult>; never throws.
 */
export function handleExtractProfile(
  deps: Deps,
  req: ExtractProfileRequest,
): ApiResult<ExtractProfileResult> {
  log('info', 'extract_profile start', { sourceFolderId: req.sourceFolderId, model: req.model });

  const validationErr = validateExtractProfile(req as unknown as Record<string, unknown>);
  if (validationErr) {
    log('warn', 'extract_profile validation error', { message: validationErr.error.message });
    return validationErr;
  }

  // 1) Read source materials from Drive
  let materials: { text: string; files: unknown[] };
  try {
    materials = deps.drive.readSourceFiles(req.sourceFolderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'extract_profile: source folder unreadable', { error: message, sourceFolderId: req.sourceFolderId });
    return driveError(message);
  }

  // 2) Distil into a JobProfile via Claude
  let distilled: ExtractProfileResult;
  try {
    distilled = distilProfile(deps.claude, req.model, materials.text);
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log('error', 'extract_profile Claude API error', {
        errorType: err.errorType,
        status: err.statusCode,
        retryable: err.retryable,
        error: err.message,
      });
      return {
        ok: false,
        error: { type: err.errorType, message: err.message, retryable: err.retryable },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'extract_profile distillation failed', { error: message });
    return {
      ok: false,
      error: { type: 'server', message, retryable: true },
    };
  }

  log('info', 'extract_profile done', {
    skillCount: distilled.profile.skills.length,
    queryCount: distilled.profile.searchQueries.length,
    cost: distilled.cost.totalUsd,
  });
  return {
    ok: true,
    profile: distilled.profile,
    cost: distilled.cost,
  };
}
