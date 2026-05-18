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

// Reciprocal Rank Fusion (Cormack et al. 2009): each list contributes 1/(k+rank); missing jobs contribute 0.
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

// Undated jobs sink to the end (NEGATIVE_INFINITY ts) so they get the worst recency rank but still appear.
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

// Role-fit tiers: 2 = preferred family, 1 = undetected (neutral), 0 = non-preferred family.
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
