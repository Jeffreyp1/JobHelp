import { mkdir, readFile, rm, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  EMPTY_STATE,
  STATE_SCHEMA_VERSION,
  type ApplicationEntry,
  type DigestEntry,
  type JobHelpState,
  type JobVerdictEntry,
  type RegisteredResumeEntry,
  type StateError,
} from './index.js';
import {
  asString,
  isPlainObject,
  parseApplicationEntry,
  parseDigestEntry,
  parseJobVerdictEntry,
  parseResumeEntry,
} from './entryParsers.js';
import { err, ok, type Result } from '../types/result.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';

const STATE_FILE_NAME = 'state.json';
const LOCK_SUFFIX = '.lock';
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

function parseState(raw: unknown): Result<JobHelpState, StateError> {
  if (!isPlainObject(raw)) {
    return err({ type: 'validation', message: 'state root must be an object' });
  }
  const rawVersion = raw['version'];
  if (rawVersion !== undefined && rawVersion !== STATE_SCHEMA_VERSION) {
    return err({
      type: 'validation',
      message: `unsupported state version: ${String(rawVersion)}`,
    });
  }
  // Legacy migration: state.json files written before the version field existed have
  // version === undefined and may omit resumes/digests. Default missing arrays to [];
  // a present-but-non-array value is still corrupt and rejected below.
  const resumesRaw = raw['resumes'] ?? [];
  const applicationsRaw = raw['applications'] ?? [];
  const digestsRaw = raw['digests'] ?? [];
  const verdictsRaw = raw['verdicts'] ?? [];
  if (!Array.isArray(resumesRaw)) {
    return err({ type: 'validation', message: 'state.resumes must be an array' });
  }
  if (!Array.isArray(applicationsRaw)) {
    return err({ type: 'validation', message: 'state.applications must be an array' });
  }
  if (!Array.isArray(digestsRaw)) {
    return err({ type: 'validation', message: 'state.digests must be an array' });
  }
  if (!Array.isArray(verdictsRaw)) {
    return err({ type: 'validation', message: 'state.verdicts must be an array' });
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
  const verdicts: JobVerdictEntry[] = [];
  for (let i = 0; i < verdictsRaw.length; i++) {
    const parsed = parseJobVerdictEntry(verdictsRaw[i]);
    if (parsed === null) {
      return err({ type: 'validation', message: `state.verdicts[${i}] invalid shape` });
    }
    verdicts.push(parsed);
  }
  const activeResumeName = asString(raw['activeResumeName']);
  if (activeResumeName !== undefined && !resumes.some((r) => r.name === activeResumeName)) {
    return err({
      type: 'validation',
      message: `state.activeResumeName "${activeResumeName}" not in resumes`,
    });
  }
  const verdictsField = verdicts.length > 0 ? { verdicts } : {};
  const state: JobHelpState =
    activeResumeName !== undefined
      ? {
          version: STATE_SCHEMA_VERSION,
          resumes,
          activeResumeName,
          applications,
          digests,
          ...verdictsField,
        }
      : { version: STATE_SCHEMA_VERSION, resumes, applications, digests, ...verdictsField };
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

export async function writeState(state: JobHelpState): Promise<Result<void, StateError>> {
  const filePath = getStateFilePath();
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: filePath, message });
  }
  const result = await atomicWriteFile(filePath, contents);
  if (!result.ok) {
    return err({ type: 'io', path: result.error.path, message: result.error.message });
  }
  return ok(undefined);
}

async function tryRemoveStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const s = await stat(lockPath);
    if (Date.now() - s.mtimeMs > staleAfterMs) {
      await rm(lockPath, { force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function acquireLock(
  lockPath: string,
  timeoutMs: number,
): Promise<Result<() => Promise<void>, StateError>> {
  const deadline = Date.now() + timeoutMs;
  const staleAfterMs = timeoutMs * 2;
  try {
    await mkdir(dirname(lockPath), { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: lockPath, message });
  }
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, mtime: Date.now() }), {
        encoding: 'utf8',
      });
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
      // EEXIST: if mtime > 2x timeout, treat as orphaned crash and clear.
      if (await tryRemoveStaleLock(lockPath, staleAfterMs)) continue;
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
