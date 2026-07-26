import type { ScoreBreakdown } from '../../core/types/pipeline.js';

export interface RerankTopJobsArgs {
  readonly topK?: number;
  readonly instructions?: string;
  /** Explicit selection (triage survivors). Wins over topK; max 100 ids. */
  readonly jobIds?: readonly string[];
}

export interface RerankJobSummary {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly remote: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  readonly postedAt?: string;
  readonly url: string;
  readonly description: string;
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
}

export interface RerankTopJobsResult {
  readonly jobs: readonly RerankJobSummary[];
  readonly resume: { readonly name: string; readonly content: string };
  readonly rerank_prompt: string;
  readonly summary: {
    readonly topK: number;
    readonly resumeChars: number;
    readonly totalJDBytes: number;
    readonly digestDate: string;
    readonly digestPath: string;
    /** Present only on the jobIds path: requested ids absent from the latest digest. */
    readonly missingIds?: readonly string[];
  };
}

export interface ValidateSourcesArgs {
  readonly source?: string;
}

export interface SourceValidationResultItem {
  readonly source: string;
  readonly label?: string;
  readonly ok: boolean;
  readonly jobCount?: number;
  readonly statusCode?: number;
  readonly error?: { readonly type: string; readonly message: string };
  readonly durationMs: number;
}

export interface ValidateSourcesSummary {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly nextStep?: string;
}

export interface ValidateSourcesResult {
  readonly results: readonly SourceValidationResultItem[];
  readonly summary: ValidateSourcesSummary;
  readonly nextSteps?: readonly string[];
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly path?: string;
  readonly detail?: string;
  readonly nextStep?: string;
}

export type SourceCoverageKind = 'keyless-disabled' | 'key-missing' | 'empty-token-list';

export interface SourceCoverageGap {
  readonly source: string;
  readonly kind: SourceCoverageKind;
  readonly hint: string;
}

export interface DoctorResult {
  readonly ready: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly nextSteps: readonly string[];
  readonly sourceCoverage: readonly SourceCoverageGap[];
}
