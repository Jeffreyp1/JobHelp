import type { NormalizedJob } from '../types/index.js';
import { detectRoleFamily, type RoleFamily } from './classify.js';
import { log } from '../lib/log.js';

export interface RankedListEntry<T> {
  readonly job: T;
  readonly rank: number;
}

export interface RankedList<T> {
  readonly items: readonly RankedListEntry<T>[];
}

export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion (Cormack et al. 2009).
 *
 * For each ranked list, every entry contributes `1 / (k + rank)` to its job's
 * cumulative score; jobs missing from a list contribute 0 (they're effectively
 * ranked at infinity). The fused score is the sum across all lists.
 *
 * Lists must be pre-sorted by their signal and use 1-indexed ranks (top job is
 * rank 1). Each list MAY contain a different subset of the global pool;
 * `keyFn(job)` is the join key.
 *
 * Returns a map keyed by `keyFn(job)`. Empty input → empty map.
 *
 * `k` defaults to 60 (the constant from Cormack's original paper). Invalid
 * `k` (non-finite or <= 0) falls back to 60 for numerical safety; this is a
 * defensive guard, not a user-facing API.
 */
export function computeRrf<T>(
  lists: readonly RankedList<T>[],
  keyFn: (job: T) => string,
  k: number = RRF_K,
): Map<string, number> {
  const effectiveK = Number.isFinite(k) && k > 0 ? k : RRF_K;
  const scores = new Map<string, number>();
  lists.forEach((list, listIndex) => {
    const seen = new Set<string>();
    for (const entry of list.items) {
      if (!Number.isFinite(entry.rank) || entry.rank <= 0) continue;
      const key = keyFn(entry.job);
      if (seen.has(key)) {
        log('warn', 'rrf.duplicate_key_in_list', { key, listIndex });
        continue;
      }
      seen.add(key);
      const contribution = 1 / (effectiveK + entry.rank);
      scores.set(key, (scores.get(key) ?? 0) + contribution);
    }
  });
  return scores;
}

function jobKey(j: NormalizedJob): string {
  return j.id;
}

/**
 * Build a recency-ranked list from a job pool.
 *
 * Sort order: most-recent `postedAt` first. Undated jobs (missing or empty
 * `postedAt`, unparseable timestamps) sink to the END — they get the worst
 * rank in the recency dimension, so they contribute the smallest RRF
 * increment. This preserves the missing-data-never-drops invariant (they
 * still appear in the pool) while letting dated postings dominate when
 * recency matters.
 *
 * Ranks are 1-indexed and dense (no gaps); ties are broken by id for
 * determinism.
 */
export function buildRecencyRank(
  jobs: readonly NormalizedJob[],
): RankedList<NormalizedJob> {
  const withTs = jobs.map((job) => {
    const raw = job.postedAt;
    if (raw === undefined || raw === '') return { job, ts: Number.NEGATIVE_INFINITY };
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return { job, ts: Number.NEGATIVE_INFINITY };
    return { job, ts };
  });
  withTs.sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.job.id.localeCompare(b.job.id);
  });
  return {
    items: withTs.map(({ job }, idx) => ({ job, rank: idx + 1 })),
  };
}

/**
 * Build a BM25F-ranked list. Caller supplies the per-job BM25F scores keyed
 * by `job.id`. Jobs missing from the score map default to 0. Higher score →
 * better rank. Ties broken by id for determinism.
 */
export function buildBm25Rank(
  jobs: readonly NormalizedJob[],
  scoresById: ReadonlyMap<string, number>,
): RankedList<NormalizedJob> {
  const withScore = jobs.map((job) => ({
    job,
    score: scoresById.get(job.id) ?? 0,
  }));
  withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.job.id.localeCompare(b.job.id);
  });
  return {
    items: withScore.map(({ job }, idx) => ({ job, rank: idx + 1 })),
  };
}

/**
 * Build a role-fit ranked list against the candidate's preferred role families.
 *
 * Strength tiers (best → worst):
 *   2: detected family is in the candidate's roleFamily list
 *   1: title yields no detected family (ambiguous — neither penalty nor reward)
 *   0: detected family is OUTSIDE the candidate's roleFamily list
 *
 * When `roleFamily` is empty (no preference), the list is irrelevant — every
 * job gets tier 1 and the RRF contribution is uniform across the pool,
 * effectively degrading to 2-list fusion.
 *
 * Ties broken by id for determinism.
 */
export function buildRoleFitRank(
  jobs: readonly NormalizedJob[],
  preferredFamilies: readonly string[],
): RankedList<NormalizedJob> {
  const pref = new Set<string>(preferredFamilies);
  const tiered = jobs.map((job) => {
    const detected: RoleFamily | undefined = detectRoleFamily(job.title, job.description);
    let tier: number;
    if (detected === undefined) tier = 1;
    else if (pref.has(detected)) tier = 2;
    else tier = 0;
    return { job, tier };
  });
  tiered.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.job.id.localeCompare(b.job.id);
  });
  return {
    items: tiered.map(({ job }, idx) => ({ job, rank: idx + 1 })),
  };
}
