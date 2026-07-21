import type { RankedJob, SourceRunResult } from '../types/index.js';

export const STATE_SCHEMA_VERSION = 1 as const;

export interface RegisteredResumeEntry {
  readonly name: string;
  readonly path: string;
  readonly registeredAt: string;
  readonly updatedAt: string;
}

export interface ApplicationEntry {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly date: string;
  readonly dir: string;
  readonly url?: string;
  readonly location?: string;
  readonly basedOnResumeName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DigestEntry {
  readonly date: string;
  readonly path: string;
  readonly jobCount: number;
  readonly createdAt: string;
}

export interface JobHelpState {
  readonly version: typeof STATE_SCHEMA_VERSION;
  readonly resumes: ReadonlyArray<RegisteredResumeEntry>;
  readonly activeResumeName?: string;
  readonly applications: ReadonlyArray<ApplicationEntry>;
  readonly digests: ReadonlyArray<DigestEntry>;
}

export interface PersistedDigest {
  readonly date: string;
  readonly generatedAt: string;
  readonly totalDurationMs: number;
  readonly sourceResults: ReadonlyArray<SourceRunResult>;
  readonly jobs: ReadonlyArray<RankedJob>;
  /** Display cut for readers: jobs beyond this index are triage-only depth, not the day's headline list. Absent on legacy digests. */
  readonly displayK?: number;
}

export const EMPTY_STATE: JobHelpState = {
  version: STATE_SCHEMA_VERSION,
  resumes: [],
  applications: [],
  digests: [],
};

export type StateErrorType = 'parse' | 'validation' | 'io' | 'lock_timeout';

export interface StateError {
  readonly type: StateErrorType;
  readonly message: string;
  readonly path?: string;
}

export type DigestErrorType = 'parse' | 'validation' | 'io' | 'not_found';

export interface DigestError {
  readonly type: DigestErrorType;
  readonly message: string;
  readonly path?: string;
}

export {
  getStateRoot,
  getStateFilePath,
  readState,
  writeState,
  updateState,
} from './store.js';

export {
  getDigestsDir,
  getDigestPath,
  getLatestPointerPath,
  persistDigest,
  getLatestDigest,
  readDigest,
} from './digestStore.js';
