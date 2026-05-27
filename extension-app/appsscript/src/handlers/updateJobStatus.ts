/**
 * @file handlers/updateJobStatus.ts
 *
 * Feature: Update Job Pipeline status (action: "update_job_status")
 * Owner agent: J4 — Phase 1 job-pipeline handlers
 *
 * Behaviour:
 *   - Validates inputs (sheetId, jobId non-empty strings; status one of the
 *     JobPipelineStatus values; tailoredDocUrl if present must be a string)
 *   - Null-checks deps.drive.updateJobPipelineStatus — if absent → driveError
 *     ("Job Pipeline sheet ops unavailable")
 *   - Otherwise calls it; returns { updatedAt } as the result
 *   - A "no such row" Error from the Drive op → typed error with type:"drive",
 *     retryable:false (it's not a transient failure — the row genuinely isn't
 *     there, so the caller shouldn't blindly retry; classifying it as "drive"
 *     keeps it distinct from a malformed request)
 *   - log() on entry/exit (every path) — NO silent failures
 *   - All error paths return ApiResult<never> with ok:false — never throws
 */

import type { Deps } from '../Code.js';
import type {
  UpdateJobStatusRequest,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import type { JobPipelineStatus } from '../types/job-discovery.js';
import { log } from '../lib/structuredLog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_STATUSES: JobPipelineStatus[] = ['new', 'tailored', 'applied', 'rejected', 'closed'];

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
 * Validate a raw request body for the "update_job_status" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateUpdateJobStatus(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['sheetId'] !== 'string' || raw['sheetId'].length === 0) {
    return validationError('Missing or invalid required field: sheetId');
  }
  if (typeof raw['jobId'] !== 'string' || raw['jobId'].length === 0) {
    return validationError('Missing or invalid required field: jobId');
  }
  if (typeof raw['status'] !== 'string' || !(VALID_STATUSES as readonly string[]).includes(raw['status'])) {
    return validationError(`Field "status" must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if ('tailoredDocUrl' in raw && raw['tailoredDocUrl'] !== undefined) {
    if (typeof raw['tailoredDocUrl'] !== 'string') {
      return validationError('Field "tailoredDocUrl" must be a string when provided');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle an "update_job_status" request.
 * Always returns ApiResult<{ updatedAt: number }>; never throws.
 */
export function handleUpdateJobStatus(
  deps: Deps,
  req: UpdateJobStatusRequest,
): ApiResult<{ updatedAt: number }> {
  log('info', 'update_job_status start', {
    sheetId: req.sheetId,
    jobId: req.jobId,
    status: req.status,
    hasTailoredDocUrl: req.tailoredDocUrl !== undefined,
  });

  const validationErr = validateUpdateJobStatus(req as unknown as Record<string, unknown>);
  if (validationErr) {
    log('warn', 'update_job_status validation error', { message: validationErr.error.message });
    return validationErr;
  }

  const updateFn = deps.drive.updateJobPipelineStatus;
  if (typeof updateFn !== 'function') {
    log('warn', 'update_job_status: Job Pipeline sheet ops unavailable', { sheetId: req.sheetId });
    return driveError('Job Pipeline sheet ops unavailable');
  }

  let result: { updatedAt: number };
  try {
    result = updateFn(req.sheetId, req.jobId, req.status, req.tailoredDocUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'update_job_status: Drive update failed', { error: message, sheetId: req.sheetId, jobId: req.jobId });
    return driveError(message);
  }

  log('info', 'update_job_status done', { sheetId: req.sheetId, jobId: req.jobId, updatedAt: result.updatedAt });
  return { ok: true, updatedAt: result.updatedAt };
}
