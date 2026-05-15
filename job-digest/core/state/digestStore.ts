import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStateRoot } from './store.js';
import { type DigestError, type PersistedDigest } from './index.js';
import { err, ok, type Result } from '../types/result.js';
import type { RankedJob, SourceRunResult } from '../types/index.js';
import {
  isPlainObject,
  parseRankedJob,
  parseSourceRunResult,
} from './digestSchema.js';

const DIGESTS_DIR_NAME = 'digests';
const LATEST_POINTER_NAME = 'latest.json';
const TMP_SUFFIX = '.tmp';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getDigestsDir(): string {
  return join(getStateRoot(), DIGESTS_DIR_NAME);
}

export function getDigestPath(date: string): string {
  return join(getDigestsDir(), `digest-${date}.json`);
}

export function getLatestPointerPath(): string {
  return join(getDigestsDir(), LATEST_POINTER_NAME);
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

function validateDigestShape(raw: unknown): Result<PersistedDigest, DigestError> {
  if (!isPlainObject(raw)) {
    return err({ type: 'validation', message: 'digest root must be an object' });
  }
  const date = raw['date'];
  const generatedAt = raw['generatedAt'];
  const totalDurationMs = raw['totalDurationMs'];
  const sourceResultsRaw = raw['sourceResults'];
  const jobsRaw = raw['jobs'];
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return err({ type: 'validation', message: 'digest.date must be YYYY-MM-DD' });
  }
  if (typeof generatedAt !== 'string') {
    return err({ type: 'validation', message: 'digest.generatedAt must be string' });
  }
  if (typeof totalDurationMs !== 'number') {
    return err({ type: 'validation', message: 'digest.totalDurationMs must be number' });
  }
  if (!Array.isArray(sourceResultsRaw)) {
    return err({ type: 'validation', message: 'digest.sourceResults must be array' });
  }
  if (!Array.isArray(jobsRaw)) {
    return err({ type: 'validation', message: 'digest.jobs must be array' });
  }
  const sourceResults: SourceRunResult[] = [];
  for (let i = 0; i < sourceResultsRaw.length; i++) {
    const parsed = parseSourceRunResult(sourceResultsRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `digest.sourceResults[${i}] invalid` });
    }
    sourceResults.push(parsed);
  }
  const jobs: RankedJob[] = [];
  for (let i = 0; i < jobsRaw.length; i++) {
    const parsed = parseRankedJob(jobsRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `digest.jobs[${i}] invalid` });
    }
    jobs.push(parsed);
  }
  return ok({ date, generatedAt, totalDurationMs, sourceResults, jobs });
}

async function atomicWriteFile(
  filePath: string,
  contents: string,
): Promise<Result<void, DigestError>> {
  const tmp = `${filePath}${TMP_SUFFIX}.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, contents, { encoding: 'utf8', flag: 'w' });
    await rename(tmp, filePath);
    return ok(undefined);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'write failed';
    try {
      await rm(tmp, { force: true });
    } catch {
      // best-effort
    }
    return err({ type: 'io', path: filePath, message });
  }
}

export async function persistDigest(
  digest: PersistedDigest,
): Promise<Result<{ readonly path: string; readonly latestPath: string }, DigestError>> {
  if (!DATE_RE.test(digest.date)) {
    return err({ type: 'validation', message: `digest.date must be YYYY-MM-DD: ${digest.date}` });
  }
  const dir = getDigestsDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: dir, message });
  }
  const filePath = getDigestPath(digest.date);
  const latestPath = getLatestPointerPath();
  const contents = `${JSON.stringify(digest, null, 2)}\n`;
  const write = await atomicWriteFile(filePath, contents);
  if (!write.ok) return err(write.error);
  const latestWrite = await atomicWriteFile(latestPath, contents);
  if (!latestWrite.ok) return err(latestWrite.error);
  return ok({ path: filePath, latestPath });
}

async function readAndValidate(filePath: string): Promise<Result<PersistedDigest, DigestError>> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return err({ type: 'not_found', path: filePath, message: `not found: ${filePath}` });
    }
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'io', path: filePath, message });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return err({ type: 'parse', path: filePath, message });
  }
  const validated = validateDigestShape(parsed);
  if (!validated.ok) return err({ ...validated.error, path: filePath });
  return validated;
}

export async function readDigest(date: string): Promise<Result<PersistedDigest, DigestError>> {
  if (!DATE_RE.test(date)) {
    return err({ type: 'validation', message: `date must be YYYY-MM-DD: ${date}` });
  }
  return readAndValidate(getDigestPath(date));
}

export async function getLatestDigest(): Promise<Result<PersistedDigest, DigestError>> {
  const filePath = getLatestPointerPath();
  const result = await readAndValidate(filePath);
  if (!result.ok && result.error.type === 'not_found') {
    return err({ type: 'not_found', path: filePath, message: 'no digest has been generated yet' });
  }
  return result;
}
