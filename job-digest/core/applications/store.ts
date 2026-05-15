import { access, mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ApplicationError,
  type ApplicationKind,
  type RecentApplication,
  type StartApplicationInput,
  type StartApplicationResult,
  type WriteApplicationOutputInput,
  type WriteApplicationOutputResult,
} from './index.js';
import { buildApplicationDir, buildApplicationDirName } from './paths.js';
import { fileNameForKind, listVersions as listVersionsImpl, nextVersion } from './versioning.js';
import type { ApplicationVersion } from './index.js';
import { updateState, readState } from '../state/store.js';
import type { ApplicationEntry, JobHelpState } from '../state/index.js';
import { err, ok, type Result } from '../types/result.js';
import { atomicWriteFile as atomicWriteFileImpl } from '../lib/atomicWrite.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APP_LOCK_FILE = '.write.lock';
const APP_LOCK_DEFAULT_TIMEOUT_MS = 5000;
const APP_LOCK_RETRY_INTERVAL_MS = 25;

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') return false;
    throw e;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function validateDate(date: string): Result<void, ApplicationError> {
  if (!DATE_RE.test(date)) {
    return err({ type: 'validation', message: `date must be YYYY-MM-DD: ${date}` });
  }
  return ok(undefined);
}

export async function startApplication(
  input: StartApplicationInput,
): Promise<Result<StartApplicationResult, ApplicationError>> {
  const dateCheck = validateDate(input.date);
  if (!dateCheck.ok) return err(dateCheck.error);
  if (input.company.trim().length === 0) {
    return err({ type: 'validation', message: 'company must be non-empty' });
  }
  if (input.role.trim().length === 0) {
    return err({ type: 'validation', message: 'role must be non-empty' });
  }
  if (input.jobId.trim().length === 0) {
    return err({ type: 'validation', message: 'jobId must be non-empty' });
  }

  let dir: string;
  try {
    dir = buildApplicationDir({
      company: input.company,
      role: input.role,
      date: input.date,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'invalid application dir parts';
    return err({ type: 'validation', message });
  }

  const existedBefore = await dirExists(dir);
  try {
    await mkdir(dir, { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: dir, message });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateState((state: JobHelpState) => {
    const existingIdx = state.applications.findIndex((a) => a.jobId === input.jobId);
    const baseEntry = {
      jobId: input.jobId,
      company: input.company,
      role: input.role,
      date: input.date,
      dir,
    };
    if (existingIdx === -1) {
      const newEntry: ApplicationEntry =
        input.basedOnResumeName !== undefined
          ? { ...baseEntry, basedOnResumeName: input.basedOnResumeName, createdAt: nowIso, updatedAt: nowIso }
          : { ...baseEntry, createdAt: nowIso, updatedAt: nowIso };
      return { ...state, applications: [...state.applications, newEntry] };
    }
    const existing = state.applications[existingIdx];
    if (existing === undefined) return state;
    const merged: ApplicationEntry =
      input.basedOnResumeName !== undefined
        ? { ...existing, ...baseEntry, basedOnResumeName: input.basedOnResumeName, updatedAt: nowIso }
        : { ...existing, ...baseEntry, updatedAt: nowIso };
    const nextApplications = state.applications.slice();
    nextApplications[existingIdx] = merged;
    return { ...state, applications: nextApplications };
  });

  if (!updated.ok) {
    return err({ type: 'state_error', message: updated.error.message });
  }

  return ok({ dir, created: !existedBefore });
}

async function atomicWriteApp(
  filePath: string,
  contents: string,
): Promise<Result<void, ApplicationError>> {
  const r = await atomicWriteFileImpl(filePath, contents);
  if (!r.ok) return err({ type: 'io', path: r.error.path, message: r.error.message });
  return ok(undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireAppLock(
  applicationDir: string,
  timeoutMs: number,
): Promise<Result<() => Promise<void>, ApplicationError>> {
  const lockPath = join(applicationDir, APP_LOCK_FILE);
  const deadline = Date.now() + timeoutMs;
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
          type: 'io',
          path: lockPath,
          message: `timed out acquiring application lock after ${timeoutMs}ms`,
        });
      }
      await sleep(APP_LOCK_RETRY_INTERVAL_MS);
    }
  }
}

async function resolveApplicationDir(
  jobId: string,
): Promise<Result<{ dir: string; entry: ApplicationEntry }, ApplicationError>> {
  const stateResult = await readState();
  if (!stateResult.ok) {
    return err({ type: 'state_error', message: stateResult.error.message });
  }
  const entry = stateResult.value.applications.find((a) => a.jobId === jobId);
  if (entry === undefined) {
    return err({
      type: 'not_found',
      message: `no application registered for jobId ${jobId}. Call startApplication first.`,
    });
  }
  return ok({ dir: entry.dir, entry });
}

export async function writeApplicationOutput(
  input: WriteApplicationOutputInput,
): Promise<Result<WriteApplicationOutputResult, ApplicationError>> {
  if (input.content.length === 0) {
    return err({ type: 'validation', message: 'content must be non-empty' });
  }
  const resolved = await resolveApplicationDir(input.jobId);
  if (!resolved.ok) return err(resolved.error);
  const { dir } = resolved.value;

  if (!(await pathExists(dir))) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'mkdir failed';
      return err({ type: 'io', path: dir, message });
    }
  }

  const lockResult = await acquireAppLock(dir, APP_LOCK_DEFAULT_TIMEOUT_MS);
  if (!lockResult.ok) return err(lockResult.error);
  const release = lockResult.value;

  let filePath: string;
  let version: number;
  try {
    try {
      version = await nextVersion(dir, input.kind);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unable to compute next version';
      return err({ type: 'io', path: dir, message });
    }
    const fileName = fileNameForKind(input.kind, version);
    filePath = join(dir, fileName);
    const write = await atomicWriteApp(filePath, input.content);
    if (!write.ok) return err(write.error);
  } finally {
    await release();
  }

  const nowIso = new Date().toISOString();
  const updated = await updateState((state: JobHelpState) => {
    const idx = state.applications.findIndex((a) => a.jobId === input.jobId);
    if (idx === -1) return state;
    const existing = state.applications[idx];
    if (existing === undefined) return state;
    const next = state.applications.slice();
    next[idx] = { ...existing, updatedAt: nowIso };
    return { ...state, applications: next };
  });
  if (!updated.ok) {
    return err({ type: 'state_error', message: updated.error.message });
  }

  return isVersionedKind(input.kind)
    ? ok({ path: filePath, version })
    : ok({ path: filePath });
}

function isVersionedKind(kind: ApplicationKind): boolean {
  return kind === 'resume' || kind === 'cover-letter';
}

export async function listApplicationVersions(
  jobId: string,
  kind: ApplicationKind,
): Promise<Result<readonly ApplicationVersion[], ApplicationError>> {
  const resolved = await resolveApplicationDir(jobId);
  if (!resolved.ok) return err(resolved.error);
  try {
    const versions = await listVersionsImpl(resolved.value.dir, kind);
    return ok(versions);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'failed to list versions';
    return err({ type: 'io', path: resolved.value.dir, message });
  }
}

export async function listRecentApplications(
  limit?: number,
): Promise<Result<readonly RecentApplication[], ApplicationError>> {
  const stateResult = await readState();
  if (!stateResult.ok) {
    return err({ type: 'state_error', message: stateResult.error.message });
  }
  const sorted = stateResult.value.applications
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sliced = limit !== undefined ? sorted.slice(0, limit) : sorted;
  return ok(sliced);
}

export { buildApplicationDirName };
