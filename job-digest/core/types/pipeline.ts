import type { NormalizedJob } from './job.js';

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
  /** Recency multiplier — `max(0.5, 1 - daysOld/30)`. */
  readonly recencyBoost: number;
  /** LLM fit-score in [0, 1], present only when {@link RankingConfig.useLlmFitScore}. */
  readonly llmFitScore?: number;
}

/**
 * A single pipeline stage transforms an input into an output.
 * Stages compose left-to-right.
 */
export type PipelineStage<I, O> = (input: I) => Promise<O> | O;
