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
  /** Reciprocal Rank Fusion score (Cormack 2009). Present only when ranking.fusion.enabled with mode 'rrf'. Raw pre-penalty RRF score (sum of `1/(k+rank_i)` across input lists); the final score is rrf x seniorityPenalty. Not in [0,1]. */
  readonly rrf?: number;
  /** Cosine similarity between the profile query and the job text, roughly [-1, 1]. Present only when ranking.semantic.enabled and the embedder was available. */
  readonly semantic?: number;
  /** Convex blend score in [0, 1]: weighted mix of min-max-normalized BM25 and semantic, times the seniority penalty. Present only when ranking.fusion.mode === 'blend'. */
  readonly blend?: number;
  /** Seniority penalty multiplier in (0, 1]. 1.0 = no penalty; < 1 when the job's detected level exceeds the profile's target. Present in both fusion modes when fusion.seniorityPenalty is on. */
  readonly seniorityPenalty?: number;
  /** Cross-encoder relevance in [0, 1] (sigmoid of the model logit). Present only on the top-K jobs reordered by ranking.rerank. */
  readonly rerank?: number;
  /** Reserved multiplier from the applied-history signal; not yet produced by rank(). */
  readonly historyBoost?: number;
  /** Demotion multiplier in (0, 1] from a stored 'skipped' verdict. Present only when a verdict demoted this job. */
  readonly verdictDemotion?: number;
  /** LLM fit-score in [0, 1]. Unused in Design B (no LLM scoring); always undefined. */
  readonly llmFitScore?: number;
}

/**
 * A single pipeline stage transforms an input into an output.
 * Stages compose left-to-right.
 */
export type PipelineStage<I, O> = (input: I) => Promise<O> | O;
