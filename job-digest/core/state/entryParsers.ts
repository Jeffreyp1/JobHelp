import type { ApplicationEntry, DigestEntry, RegisteredResumeEntry } from './index.js';

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
