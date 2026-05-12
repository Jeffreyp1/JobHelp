/**
 * @file handlers/createDriveFile.ts
 *
 * Feature: Create Drive file (action: "create_drive_file")
 * Used by the v2.1 onboarding wizard to scaffold the single
 * `jobhelp-config.json` file in the user's Drive.
 *
 * Patterns:
 *   - Handler shape: see handleResearchCompany() in handlers/research.ts
 *   - Drive call: deps.drive.createDriveFile(fileName, content, mimeType, parentFolderId?)
 *   - Error normalisation: validationError / driveError below
 *   - Validation: fileName non-empty + no Drive-illegal characters,
 *     content non-empty, content ≤ 1 MB
 *   - Errors:
 *       - validation failures → retryable: false, type: "validation"
 *       - drive failure       → retryable: false, type: "drive"
 *   - console.log on entry/exit (every path) — NO silent failures
 *   - All error paths return ApiResult<never> with ok:false — never throws
 */

import type { Deps } from '../Code.js';
import type {
  CreateDriveFileRequest,
  CreateDriveFileResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { log } from '../lib/structuredLog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on content size to prevent abuse if this action is ever exposed
 *  to untrusted callers. 1 MiB matches the README abuse-budget guidance. */
const MAX_CONTENT_BYTES = 1024 * 1024;

const DEFAULT_MIME_TYPE = 'application/json';

/** Characters that Drive forbids in file names. */
// eslint-disable-next-line no-useless-escape
const ILLEGAL_FILENAME_CHARS = /[\\\/:*?"<>|]/;

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
 * Compute UTF-8 byte length of a string. Mirrors how Drive ultimately stores
 * the bytes; this is more accurate than `.length` for inputs with multibyte
 * characters (which is the realistic case for JSON containing names / emojis).
 */
function utf8ByteLength(s: string): number {
  // Node's Buffer is available in both Vitest and the Apps Script V8 runtime
  // (via the harness's polyfills). Fallback to TextEncoder for resilience.
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(s, 'utf8');
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  // Last-resort: assume 1 byte per char (only triggered on exotic runtimes).
  return s.length;
}

/**
 * Validate a raw request body for the "create_drive_file" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateCreateDriveFile(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['fileName'] !== 'string' || raw['fileName'].length === 0) {
    return validationError('Missing or invalid required field: fileName');
  }
  if (ILLEGAL_FILENAME_CHARS.test(raw['fileName'] as string)) {
    return validationError(
      'fileName contains Drive-illegal characters. Forbidden: \\ / : * ? " < > |',
    );
  }
  if (typeof raw['content'] !== 'string' || raw['content'].length === 0) {
    return validationError('Missing or invalid required field: content');
  }
  if (utf8ByteLength(raw['content'] as string) > MAX_CONTENT_BYTES) {
    return validationError(
      `Content exceeds size limit (${MAX_CONTENT_BYTES} bytes / 1 MB)`,
    );
  }
  if ('parentFolderId' in raw && raw['parentFolderId'] !== undefined) {
    if (typeof raw['parentFolderId'] !== 'string' || raw['parentFolderId'].length === 0) {
      return validationError('Field "parentFolderId" must be a non-empty string when provided');
    }
  }
  if ('mimeType' in raw && raw['mimeType'] !== undefined) {
    if (typeof raw['mimeType'] !== 'string' || raw['mimeType'].length === 0) {
      return validationError('Field "mimeType" must be a non-empty string when provided');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a "create_drive_file" request.
 * Always returns ApiResult<CreateDriveFileResult>; never throws.
 */
export function handleCreateDriveFile(
  deps: Deps,
  req: CreateDriveFileRequest,
): ApiResult<CreateDriveFileResult> {
  log('info', 'create_drive_file start', {
    fileName: req.fileName,
    parentFolderId: req.parentFolderId ?? null,
    mimeType: req.mimeType ?? DEFAULT_MIME_TYPE,
  });

  // Defensive validation in case caller bypassed validateCreateDriveFile
  const validationErr = validateCreateDriveFile(
    req as unknown as Record<string, unknown>,
  );
  if (validationErr) {
    log('warn', 'create_drive_file validation error', { message: validationErr.error.message });
    return validationErr;
  }

  const mimeType = req.mimeType ?? DEFAULT_MIME_TYPE;

  let result: { fileId: string; fileUrl: string };
  try {
    result = deps.drive.createDriveFile(
      req.fileName,
      req.content,
      mimeType,
      req.parentFolderId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'create_drive_file drive failure', { error: message, fileName: req.fileName });
    return driveError(message);
  }

  log('info', 'create_drive_file done', { fileId: result.fileId });
  return {
    ok: true,
    fileId: result.fileId,
    fileUrl: result.fileUrl,
  };
}
