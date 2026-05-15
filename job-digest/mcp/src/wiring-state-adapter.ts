import type {
  JobHelpStateMinimal,
  ResumeRecord,
  StateStore as ResumeStateStore,
  StateError as ResumeStateError,
} from '../../core/resumes/registry.js';
import { readState, updateState } from '../../core/state/store.js';
import {
  STATE_SCHEMA_VERSION,
  type JobHelpState,
  type RegisteredResumeEntry,
  type StateError,
} from '../../core/state/index.js';
import { err, ok, type Result } from '../../core/types/result.js';

function toMinimal(s: JobHelpState): JobHelpStateMinimal {
  const resumes: Record<string, ResumeRecord> = {};
  for (const r of s.resumes) {
    resumes[r.name] = { path: r.path, registeredAt: r.registeredAt };
  }
  return { resumes, activeResumeName: s.activeResumeName ?? null };
}

function fromMinimal(base: JobHelpState, minimal: JobHelpStateMinimal): JobHelpState {
  const existingByName = new Map<string, RegisteredResumeEntry>();
  for (const r of base.resumes) existingByName.set(r.name, r);
  const nowIso = new Date().toISOString();
  const nextResumes: RegisteredResumeEntry[] = [];
  for (const [name, record] of Object.entries(minimal.resumes)) {
    const existing = existingByName.get(name);
    if (existing !== undefined) {
      nextResumes.push({
        name,
        path: record.path,
        registeredAt: existing.registeredAt,
        updatedAt: nowIso,
      });
    } else {
      nextResumes.push({
        name,
        path: record.path,
        registeredAt: record.registeredAt,
        updatedAt: record.registeredAt,
      });
    }
  }
  return minimal.activeResumeName !== null
    ? {
        version: STATE_SCHEMA_VERSION,
        resumes: nextResumes,
        activeResumeName: minimal.activeResumeName,
        applications: base.applications,
        digests: base.digests,
      }
    : {
        version: STATE_SCHEMA_VERSION,
        resumes: nextResumes,
        applications: base.applications,
        digests: base.digests,
      };
}

function mapStateError(e: StateError): ResumeStateError {
  if (e.type === 'parse' || e.type === 'validation') {
    return { type: 'parse', message: e.message };
  }
  return { type: 'io', message: e.message };
}

export function createResumeStateAdapter(): ResumeStateStore {
  return {
    read: async (): Promise<Result<JobHelpStateMinimal, ResumeStateError>> => {
      const r = await readState();
      if (!r.ok) return err(mapStateError(r.error));
      return ok(toMinimal(r.value));
    },
    write: async (
      patch: (s: JobHelpStateMinimal) => JobHelpStateMinimal,
    ): Promise<Result<void, ResumeStateError>> => {
      const updated = await updateState((s) => fromMinimal(s, patch(toMinimal(s))));
      if (!updated.ok) return err(mapStateError(updated.error));
      return ok(undefined);
    },
  };
}
