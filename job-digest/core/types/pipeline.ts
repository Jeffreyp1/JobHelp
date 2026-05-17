import type { NormalizedJob } from './job.js';

export type { RoleFamily, SeniorityLevel } from '../pipeline/classify.js';

/**
 * A job after the pipeline finishes — carries score, rank, and breakdown.
 */
export interface RankedJob {
  readonly job: NormalizedJob;
  /** 1-indexed rank in the digest. */
  readonly rank: number;
  /** Final score in [0, 1]. Higher is better. */
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  /** Optional LLM-generated rationale, shown to the user in the digest. */
  readonly llmRationale?: string;
}

/**
 * Score breakdown for explainability. All values in [0, 1] unless noted.
 */
export interface ScoreBreakdown {
  /** Weighted keyword-overlap score from {@link normalize}/{@link rank}. */
  readonly keywordOverlap: number;
  /** Recency multiplier in [0, 1]. Half-life decay when enabled; 1.0 when disabled or undated. */
  readonly recencyBoost: number;
  /** Field-weighted BM25 score. Raw (unbounded ≥ 0); not in [0,1]. */
  readonly bm25f: number;
  /** Source-trust multiplier in [0, ∞). 1.0 when disabled or source key missing. Optional for back-compat with pre-Phase-3 fixtures. */
  readonly sourceTrust?: number;
  /** LLM fit-score in [0, 1], present only when {@link RankingConfig.useLlmFitScore}. */
  readonly llmFitScore?: number;
}

/**
 * A single pipeline stage transforms an input into an output.
 * Stages compose left-to-right.
 */
export type PipelineStage<I, O> = (input: I) => Promise<O> | O;
