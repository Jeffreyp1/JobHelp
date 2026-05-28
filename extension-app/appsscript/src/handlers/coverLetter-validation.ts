import type {
  ApiErrorResponse,
  CoverLetterTone,
} from '../types/api-contract.js';
import { log } from '../lib/structuredLog.js';

const VALID_TONES: readonly CoverLetterTone[] = [
  'formal',
  'casual',
  'technical',
  'persuasive',
  'neutral',
] as const;

export function validateCoverLetter(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  const requiredStringFields = [
    'resumeMd',
    'jd',
    'jobFolderId',
    'sourceFolderId',
    'rulesFolderId',
    'model',
  ];

  for (const field of requiredStringFields) {
    if (!raw[field] || typeof raw[field] !== 'string') {
      log('warn', 'coverLetter validation failed: missing or invalid field', { field });
      return {
        ok: false,
        error: {
          type: 'validation',
          message: `Missing required field: ${field}`,
          retryable: false,
        },
      };
    }
  }

  if (raw['tone'] !== undefined && raw['tone'] !== null) {
    if (
      typeof raw['tone'] !== 'string' ||
      !VALID_TONES.includes(raw['tone'] as CoverLetterTone)
    ) {
      log('warn', 'coverLetter validation failed: invalid tone', { tone: String(raw['tone']) });
      return {
        ok: false,
        error: {
          type: 'validation',
          message:
            `Invalid tone: ${String(raw['tone'])}. ` +
            `Must be one of: ${VALID_TONES.join(', ')}`,
          retryable: false,
        },
      };
    }
  }

  for (const field of ['company', 'role'] as const) {
    if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string') {
      log('warn', 'coverLetter validation failed: optional field has wrong type', { field });
      return {
        ok: false,
        error: {
          type: 'validation',
          message: `Field "${field}", when provided, must be a string or null`,
          retryable: false,
        },
      };
    }
  }
  return null;
}
