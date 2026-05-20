import type {
  JobDigestConfig,
  MaxAgeConfig,
  NormalizedJob,
  RankedJob,
  RankingConfig,
  RecencyConfig,
} from '../types/index.js';
import { DEFAULT_MAX_AGE, DEFAULT_RECENCY } from '../lib/config-ranking.js';
import { log } from '../lib/log.js';
import { normalize } from './normalize.js';
import { dedupe } from './dedupe.js';
import { filter } from './filter.js';
import { rank, buildRankPrecomputed } from './rank.js';

// Per-call overrides. Each field wins over config for this call only; no disk writes.
export interface PipelineOverrides {
  // null disables age filter; number forces enabled=true with that day count; undefined leaves config.
  readonly maxAgeDays?: number | null;
  // toggles recency.enabled for this call only; halfLifeDays preserved from config.
  readonly recencyEnabled?: boolean;
  // Clock injection for deterministic tests. Defaults to `new Date()`.
  readonly now?: Date;
}

function applyOverrides(
  ranking: RankingConfig,
  overrides: PipelineOverrides,
): RankingConfig {
  const baseMaxAge: MaxAgeConfig = ranking.maxAge ?? DEFAULT_MAX_AGE;
  const baseRecency: RecencyConfig = ranking.recency ?? DEFAULT_RECENCY;
  let maxAge: MaxAgeConfig = baseMaxAge;
  if (overrides.maxAgeDays === null) {
    maxAge = { enabled: false, days: baseMaxAge.days, requireDate: baseMaxAge.requireDate };
  } else if (typeof overrides.maxAgeDays === 'number') {
    maxAge = { enabled: true, days: overrides.maxAgeDays, requireDate: baseMaxAge.requireDate };
  }

  let recency: RecencyConfig = baseRecency;
  if (overrides.recencyEnabled !== undefined) {
    recency = { enabled: overrides.recencyEnabled, halfLifeDays: baseRecency.halfLifeDays };
  }

  return { ...ranking, maxAge, recency };
}

// normalize -> dedupe -> filter -> rank. Rank precomputation runs once over the post-filter pool.
export async function runPipeline(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  overrides: PipelineOverrides = {},
): Promise<readonly RankedJob[]> {
  const effectiveRanking = applyOverrides(config.ranking, overrides);
  const effectiveConfig: JobDigestConfig = { ...config, ranking: effectiveRanking };
  const now = overrides.now ?? new Date();

  const t0 = Date.now();
  const normalized = await normalize(jobs);
  const t1 = Date.now();
  const deduped = await dedupe(normalized);
  const t2 = Date.now();
  const filtered = await filter(deduped, effectiveConfig, now);
  const t3 = Date.now();
  const precomputed = buildRankPrecomputed(filtered, effectiveConfig);
  const t4 = Date.now();
  const ranked = await rank(filtered, effectiveConfig, precomputed, now);
  const t5 = Date.now();
  log('info', 'pipeline.timing', {
    inputJobs: jobs.length,
    afterNormalize: normalized.length,
    afterDedupe: deduped.length,
    afterFilter: filtered.length,
    normalizeMs: t1 - t0,
    dedupeMs: t2 - t1,
    filterMs: t3 - t2,
    buildCorpusMs: t4 - t3,
    rankMs: t5 - t4,
  });
  return ranked;
}
