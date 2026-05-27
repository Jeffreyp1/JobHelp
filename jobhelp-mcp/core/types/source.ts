import type { JobDigestConfig } from './config.js';
import type { NormalizedJob } from './job.js';

/**
 * Contract every job-source adapter must implement.
 * One file per adapter under core/sources/. Each adapter is fault-isolated:
 * a thrown error from one adapter MUST NOT prevent the others from running.
 */
export interface SourceAdapter {
  /** Stable name used in NormalizedJob.source and in logs/configs. */
  readonly name: string;
  /** True iff the adapter has the auth/config it needs to run. */
  readonly enabled: (config: JobDigestConfig) => boolean;
  /**
   * Fetch and normalize. May throw on transport-level failure;
   * the orchestrator catches and converts to a {@link SourceError}.
   */
  readonly fetch: (config: JobDigestConfig) => Promise<readonly NormalizedJob[]>;
}

/** Per-source outcome of a digest run. */
export interface SourceRunResult {
  readonly source: string;
  readonly jobCount: number;
  readonly error?: SourceError;
  readonly durationMs: number;
}

export interface SourceError {
  readonly type: SourceErrorType;
  readonly message: string;
}

export type SourceErrorType =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'parse'
  | 'not_found'
  | 'server'
  | 'client'
  | 'unknown';
