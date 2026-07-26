import {
  JOB_VERDICTS,
  type ApplicationEntry,
  type DigestEntry,
  type JobVerdict,
  type JobVerdictEntry,
  type RegisteredResumeEntry,
} from './index.js';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

export function parseResumeEntry(raw: unknown): RegisteredResumeEntry | null {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw['name']);
  const path = asString(raw['path']);
  const registeredAt = asString(raw['registeredAt']);
  const updatedAt = asString(raw['updatedAt']);
  if (name === undefined || path === undefined) return null;
  if (registeredAt === undefined || updatedAt === undefined) return null;
  return { name, path, registeredAt, updatedAt };
}

export function parseApplicationEntry(raw: unknown): ApplicationEntry | null {
  if (!isPlainObject(raw)) return null;
  const jobId = asString(raw['jobId']);
  const company = asString(raw['company']);
  const role = asString(raw['role']);
  const date = asString(raw['date']);
  const dir = asString(raw['dir']);
  const createdAt = asString(raw['createdAt']);
  const updatedAt = asString(raw['updatedAt']);
  if (
    jobId === undefined ||
    company === undefined ||
    role === undefined ||
    date === undefined ||
    dir === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  const url = asString(raw['url']);
  const location = asString(raw['location']);
  const basedOnResumeName = asString(raw['basedOnResumeName']);
  return {
    jobId,
    company,
    role,
    date,
    dir,
    createdAt,
    updatedAt,
    ...(url !== undefined ? { url } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(basedOnResumeName !== undefined ? { basedOnResumeName } : {}),
  };
}

function asVerdict(v: unknown): JobVerdict | undefined {
  return typeof v === 'string' && (JOB_VERDICTS as readonly string[]).includes(v)
    ? (v as JobVerdict)
    : undefined;
}

export function parseJobVerdictEntry(raw: unknown): JobVerdictEntry | null {
  if (!isPlainObject(raw)) return null;
  const identityKey = asString(raw['identityKey']);
  const company = asString(raw['company']);
  const title = asString(raw['title']);
  const verdict = asVerdict(raw['verdict']);
  const at = asString(raw['at']);
  if (
    identityKey === undefined ||
    company === undefined ||
    title === undefined ||
    verdict === undefined ||
    at === undefined
  ) {
    return null;
  }
  const jobId = asString(raw['jobId']);
  const url = asString(raw['url']);
  const reason = asString(raw['reason']);
  return {
    identityKey,
    company,
    title,
    verdict,
    at,
    ...(jobId !== undefined ? { jobId } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export function parseDigestEntry(raw: unknown): DigestEntry | null {
  if (!isPlainObject(raw)) return null;
  const date = asString(raw['date']);
  const path = asString(raw['path']);
  const jobCount = asNumber(raw['jobCount']);
  const createdAt = asString(raw['createdAt']);
  if (date === undefined || path === undefined || jobCount === undefined || createdAt === undefined) {
    return null;
  }
  return { date, path, jobCount, createdAt };
}
