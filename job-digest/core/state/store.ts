import { mkdir, readFile, rename, rm, writeFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  EMPTY_STATE,
  STATE_SCHEMA_VERSION,
  type ApplicationEntry,
  type DigestEntry,
  type JobHelpState,
  type RegisteredResumeEntry,
  type StateError,
} from './index.js';
import { err, ok, type Result } from '../types/result.js';

const STATE_FILE_NAME = 'state.json';
const LOCK_SUFFIX = '.lock';
const TMP_SUFFIX = '.tmp';
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_INTERVAL_MS = 25;

export function getStateRoot(): string {
  const override = process.env['JOBHELP_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), 'jobhelp');
}

export function getStateFilePath(): string {
  return join(getStateRoot(), STATE_FILE_NAME);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function parseResumeEntry(raw: unknown): RegisteredResumeEntry | null {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw['name']);
  const path = asString(raw['path']);
  const registeredAt = asString(raw['registeredAt']);
  const updatedAt = asString(raw['updatedAt']);
  if (name === undefined || path === undefined) return null;
  if (registeredAt === undefined || updatedAt === undefined) return null;
  return { name, path, registeredAt, updatedAt };
}

function parseApplicationEntry(raw: unknown): ApplicationEntry | null {
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
  const basedOnResumeName = asString(raw['basedOnResumeName']);
  const entry: ApplicationEntry =
    basedOnResumeName !== undefined
      ? { jobId, company, role, date, dir, basedOnResumeName, createdAt, updatedAt }
      : { jobId, company, role, date, dir, createdAt, updatedAt };
  return entry;
}

function parseDigestEntry(raw: unknown): DigestEntry | null {
  if (!isPlainObject(raw)) return null;
  const date = asString(raw['date']);
  const path = asString(raw['path']);
  const jobCount = asNumber(raw['jobCount']);
  const createdAt = asString(raw['createdAt']);
  if (
    date === undefined ||
    path === undefined ||
    jobCount === undefined ||
    createdAt === undefined
  ) {
    return null;
  }
  return { date, path, jobCount, createdAt };
}

function parseState(raw: unknown): Result<JobHelpState, StateError> {
  if (!isPlainObject(raw)) {
    return err({ type: 'validation', message: 'state root must be an object' });
  }
  if (raw['version'] !== STATE_SCHEMA_VERSION) {
    return err({
      type: 'validation',
      message: `unsupported state version: ${String(raw['version'])}`,
    });
  }
  const resumesRaw = raw['resumes'];
  const applicationsRaw = raw['applications'];
  const digestsRaw = raw['digests'];
  if (!Array.isArray(resumesRaw)) {
    return err({ type: 'validation', message: 'state.resumes must be an array' });
  }
  if (!Array.isArray(applicationsRaw)) {
    return err({ type: 'validation', message: 'state.applications must be an array' });
  }
  if (!Array.isArray(digestsRaw)) {
    return err({ type: 'validation', message: 'state.digests must be an array' });
  }
  const resumes: RegisteredResumeEntry[] = [];
  for (let i = 0; i < resumesRaw.length; i++) {
    const parsed = parseResumeEntry(resumesRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `state.resumes[${i}] invalid shape` });
    }
    resumes.push(parsed);
  }
  const applications: ApplicationEntry[] = [];
  for (let i = 0; i < applicationsRaw.length; i++) {
    const parsed = parseApplicationEntry(applicationsRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `state.applications[${i}] invalid shape` });
    }
    applications.push(parsed);
  }
  const digests: DigestEntry[] = [];
  for (let i = 0; i < digestsRaw.length; i++) {
    const parsed = parseDigestEntry(digestsRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `state.digests[${i}] invalid shape` });
    }
    digests.push(parsed);
  }
  const activeResumeName = asString(raw['activeResumeName']);
  if (activeResumeName !== undefined && !resumes.some((r) => r.name === activeResumeName)) {
    return err({
      type: 'validation',
      message: `state.activeResumeName "${activeResumeName}" not in resumes`,
    });
  }
  const state: JobHelpState =
    activeResumeName !== undefined
      ? {
          version: STATE_SCHEMA_VERSION,
          resumes,
          activeResumeName,
          applications,
          digests,
        }
      : { version: STATE_SCHEMA_VERSION, resumes, applications, digests };
  return ok(state);
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

export async function readState(): Promise<Result<JobHelpState, StateError>> {
  const filePath = getStateFilePath();
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return ok(EMPTY_STATE);
    }
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'io', path: filePath, message });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return err({ type: 'parse', path: filePath, message: `failed to parse state JSON: ${message}` });
  }
  const result = parseState(parsed);
  if (!result.ok) {
    return err({ ...result.error, path: filePath });
  }
  return result;
}

async function atomicWrite(filePath: string, contents: string): Promise<Result<void, StateError>> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: filePath, message });
  }
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
      // best-effort cleanup
    }
    return err({ type: 'io', path: filePath, message });
  }
}

export async function writeState(state: JobHelpState): Promise<Result<void, StateError>> {
  const filePath = getStateFilePath();
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  return atomicWrite(filePath, contents);
}

async function acquireLock(
  lockPath: string,
  timeoutMs: number,
): Promise<Result<() => Promise<void>, StateError>> {
  const deadline = Date.now() + timeoutMs;
  try {
    await mkdir(dirname(lockPath), { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: lockPath, message });
  }
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.close();
      const release = async (): Promise<void> => {
        try {
          await rm(lockPath, { force: true });
        } catch {
          // best-effort
        }
      };
      return ok(release);
    } catch (e: unknown) {
      if (getStringCode(e) !== 'EEXIST') {
        const message = e instanceof Error ? e.message : 'lock create failed';
        return err({ type: 'io', path: lockPath, message });
      }
      if (Date.now() >= deadline) {
        return err({
          type: 'lock_timeout',
          path: lockPath,
          message: `timed out acquiring lock after ${timeoutMs}ms`,
        });
      }
      await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface UpdateStateOptions {
  readonly lockTimeoutMs?: number;
}

export async function updateState(
  mutator: (state: JobHelpState) => JobHelpState,
  options?: UpdateStateOptions,
): Promise<Result<JobHelpState, StateError>> {
  const filePath = getStateFilePath();
  const lockPath = `${filePath}${LOCK_SUFFIX}`;
  const timeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const lockResult = await acquireLock(lockPath, timeoutMs);
  if (!lockResult.ok) return err(lockResult.error);
  const release = lockResult.value;
  try {
    const current = await readState();
    if (!current.ok) return err(current.error);
    const next = mutator(current.value);
    const writeResult = await writeState(next);
    if (!writeResult.ok) return err(writeResult.error);
    return ok(next);
  } finally {
    await release();
  }
}
