import { err, ok, type Result } from '../types/result.js';
import type { ApplicationError } from './index.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIRECT_JOB_ID_RE = /^direct:[^:]+:[^:]+:\d{4}-\d{2}-\d{2}:([a-f0-9]{16})$/;

export function validateDate(date: string): Result<void, ApplicationError> {
  if (!DATE_RE.test(date)) {
    return err({ type: 'validation', message: `date must be YYYY-MM-DD: ${date}` });
  }
  return ok(undefined);
}

export function directJobDirRole(jobId: string, role: string): string {
  const match = DIRECT_JOB_ID_RE.exec(jobId);
  const suffix = match?.[1];
  return suffix === undefined ? role : `${role}-${suffix}`;
}
