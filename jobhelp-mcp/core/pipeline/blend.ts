import type { NormalizedJob } from '../types/index.js';
import type { Seniority } from '../types/config.js';
import { detectSeniorityLevel, type SeniorityLevel } from './classify.js';

const LEVEL_ORDER: Readonly<Record<SeniorityLevel, number>> = {
  intern: 0,
  entry: 1,
  mid: 2,
  senior: 3,
  staff: 4,
};

export interface BlendOptions {
  readonly wBm25: number;
  readonly wSemantic: number;
  readonly seniorityPenalty: boolean;
  readonly candidateLevel: Seniority;
}

export interface BlendResult {
  readonly blend: number;
  readonly penalty: number;
}

// Graduated demotion for jobs above the candidate's target level. A new-grad matching on
// domain keywords still shouldn't outrank on a "Principal, 15+ years" role, which pure
// keyword/semantic overlap would otherwise float to the top. Jobs at or below level, and
// jobs with no detectable level, are never penalized. Exact-level PROMOTION lives in the
// RRF level-fit list, not here: a multiplier lets level override fit (a benchmarked
// T4-above-T2 inversion), while an extra rank list stays a bounded tiebreaker.
export function seniorityPenaltyFor(
  jobLevel: SeniorityLevel | undefined,
  candidateLevel: Seniority,
): number {
  if (jobLevel === undefined) return 1;
  const candidate = LEVEL_ORDER[candidateLevel];
  if (candidate === undefined) return 1;
  const gap = LEVEL_ORDER[jobLevel] - candidate;
  if (gap <= 0) return 1;
  if (gap === 1) return 0.85;
  if (gap === 2) return 0.6;
  return 0.4;
}

export function seniorityPenaltiesFor(
  jobs: readonly NormalizedJob[],
  candidateLevel: Seniority,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const job of jobs) {
    out.set(
      job.id,
      seniorityPenaltyFor(detectSeniorityLevel(job.title, job.description), candidateLevel),
    );
  }
  return out;
}

// Returns a min-max scaler mapping the observed range onto [0, 1]. A degenerate range
// (all-equal, empty, or non-finite) maps everything to 0 so a flat signal adds nothing.
function minMaxScaler(values: readonly number[]): (v: number) => number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return () => 0;
  return (v: number): number => (Number.isFinite(v) ? (v - lo) / span : 0);
}

// Convex blend of min-max-normalized BM25 and semantic similarity, times an optional
// seniority penalty. Unlike RRF this keeps score magnitude, so a zero-BM25/zero-semantic
// job stays near 0 instead of being floated up by its position in a weak side-list.
// When semantic is unavailable the mix collapses to BM25-only (semantic weight -> 0).
export function computeBlendScores(
  jobs: readonly NormalizedJob[],
  bm25ById: ReadonlyMap<string, number>,
  semanticById: ReadonlyMap<string, number> | undefined,
  opts: BlendOptions,
): Map<string, BlendResult> {
  const hasSemantic = semanticById !== undefined;
  const normBm25 = minMaxScaler(jobs.map((j) => bm25ById.get(j.id) ?? 0));
  const normSem = hasSemantic
    ? minMaxScaler(jobs.map((j) => semanticById.get(j.id) ?? 0))
    : (): number => 0;

  const wBm25 = opts.wBm25;
  const wSem = hasSemantic ? opts.wSemantic : 0;
  const wSum = wBm25 + wSem;

  const out = new Map<string, BlendResult>();
  for (const job of jobs) {
    const bmN = normBm25(bm25ById.get(job.id) ?? 0);
    const semN = hasSemantic ? normSem(semanticById.get(job.id) ?? 0) : 0;
    const mixed = wSum > 0 ? (wBm25 * bmN + wSem * semN) / wSum : 0;
    const penalty = opts.seniorityPenalty
      ? seniorityPenaltyFor(detectSeniorityLevel(job.title, job.description), opts.candidateLevel)
      : 1;
    out.set(job.id, { blend: mixed * penalty, penalty });
  }
  return out;
}
