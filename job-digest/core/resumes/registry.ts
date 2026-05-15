import { err, ok, type Result } from '../types/result.js';
import {
  readResumeFile,
  resumePath,
  statResumeFile,
  writeResumeFile,
  type StoreError,
} from './store.js';

export interface ResumeRecord {
  readonly path: string;
  readonly registeredAt: string;
}

export interface JobHelpStateMinimal {
  readonly resumes: Readonly<Record<string, ResumeRecord>>;
  readonly activeResumeName: string | null;
}

export interface StateError {
  readonly type: 'io' | 'parse' | 'not_found';
  readonly message: string;
}

export interface StateStore {
  readonly read: () => Promise<Result<JobHelpStateMinimal, StateError>>;
  readonly write: (
    patch: (s: JobHelpStateMinimal) => JobHelpStateMinimal,
  ) => Promise<Result<void, StateError>>;
}

export interface RegistryError {
  readonly type: 'invalid_name' | 'invalid_content' | 'not_found' | 'no_active' | 'io';
  readonly message: string;
}

export interface RegistryDeps {
  readonly store: StateStore;
  readonly resumesDir: string;
}

export interface RegisterResumeInput {
  readonly name: string;
  readonly content: string;
}

export interface SetActiveResumeInput {
  readonly name: string;
}

export interface ReadResumeInput {
  readonly name?: string;
}

export interface ResumeListEntry {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
}

export interface Registry {
  readonly registerResume: (
    input: RegisterResumeInput,
  ) => Promise<Result<{ readonly name: string; readonly path: string }, RegistryError>>;
  readonly setActiveResume: (input: SetActiveResumeInput) => Promise<Result<void, RegistryError>>;
  readonly readResume: (
    input: ReadResumeInput,
  ) => Promise<Result<string, RegistryError>>;
  readonly listResumes: () => Promise<Result<readonly ResumeListEntry[], RegistryError>>;
}

const VALID_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isValidName(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (!VALID_NAME_RE.test(name)) return false;
  if (name.endsWith('.md')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
}

function toRegistryError(e: StoreError | StateError): RegistryError {
  if (e.type === 'not_found') return { type: 'not_found', message: e.message };
  return { type: 'io', message: e.message };
}

export function createRegistry(deps: RegistryDeps): Registry {
  const { store, resumesDir } = deps;

  async function registerResume(
    input: RegisterResumeInput,
  ): Promise<Result<{ readonly name: string; readonly path: string }, RegistryError>> {
    const { name, content } = input;
    if (!isValidName(name)) {
      return err({
        type: 'invalid_name',
        message:
          'name must match [A-Za-z0-9][A-Za-z0-9._-]* (no slashes, no .md suffix, no leading dot)',
      });
    }
    if (content.trim().length === 0) {
      return err({ type: 'invalid_content', message: 'resume content must be non-empty' });
    }
    const written = await writeResumeFile(resumesDir, name, content);
    if (!written.ok) return err(toRegistryError(written.error));
    const path = written.value;
    const registeredAt = new Date().toISOString();
    const patched = await store.write((s) => {
      const nextResumes: Record<string, ResumeRecord> = { ...s.resumes };
      nextResumes[name] = { path, registeredAt };
      const nextActive = s.activeResumeName === null ? name : s.activeResumeName;
      return { ...s, resumes: nextResumes, activeResumeName: nextActive };
    });
    if (!patched.ok) return err(toRegistryError(patched.error));
    return ok({ name, path });
  }

  async function setActiveResume(
    input: SetActiveResumeInput,
  ): Promise<Result<void, RegistryError>> {
    const { name } = input;
    const stateRead = await store.read();
    if (!stateRead.ok) return err(toRegistryError(stateRead.error));
    if (stateRead.value.resumes[name] === undefined) {
      return err({ type: 'not_found', message: `resume not registered: ${name}` });
    }
    const patched = await store.write((s) => ({ ...s, activeResumeName: name }));
    if (!patched.ok) return err(toRegistryError(patched.error));
    return ok(undefined);
  }

  async function readResume(input: ReadResumeInput): Promise<Result<string, RegistryError>> {
    const stateRead = await store.read();
    if (!stateRead.ok) return err(toRegistryError(stateRead.error));
    const s = stateRead.value;
    const targetName = input.name ?? s.activeResumeName;
    if (targetName === null) {
      return err({ type: 'no_active', message: 'no active resume set' });
    }
    const record = s.resumes[targetName];
    if (record === undefined) {
      return err({ type: 'not_found', message: `resume not registered: ${targetName}` });
    }
    const path = record.path !== '' ? record.path : resumePath(resumesDir, targetName);
    const content = await readResumeFile(path);
    if (!content.ok) return err(toRegistryError(content.error));
    return ok(content.value);
  }

  async function listResumes(): Promise<Result<readonly ResumeListEntry[], RegistryError>> {
    const stateRead = await store.read();
    if (!stateRead.ok) return err(toRegistryError(stateRead.error));
    const entries: ResumeListEntry[] = [];
    for (const [name, record] of Object.entries(stateRead.value.resumes)) {
      const path = record.path !== '' ? record.path : resumePath(resumesDir, name);
      const info = await statResumeFile(path);
      if (!info.ok) return err(toRegistryError(info.error));
      entries.push({
        name,
        path: info.value.path,
        size: info.value.size,
        modifiedAt: info.value.modifiedAt,
      });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return ok(Object.freeze(entries));
  }

  return { registerResume, setActiveResume, readResume, listResumes };
}
