import type {
  JobDigestConfig,
  MaxAgeConfig,
  NormalizedJob,
  RankedJob,
  RankingConfig,
  RecencyConfig,
} from '../types/index.js';
import { DEFAULT_MAX_AGE, DEFAULT_RECENCY } from '../lib/config-ranking.js';
import { normalize } from './normalize.js';
import { dedupe } from './dedupe.js';
import { filter } from './filter.js';
import { rank, buildRankPrecomputed } from './rank.js';

/**
 * Per-call overrides for `runPipeline`. Each field is independent; when set, it
 * wins over the corresponding field in the persistent config for the duration
 * of this call only (no disk writes).
 */
export interface PipelineOverrides {
  /**
   * Per-call age cutoff in days.
   * - `null` disables the age filter for this call.
   * - A `number` overrides `config.ranking.maxAge.days` and forces `enabled = true`.
   * - `undefined` leaves the config value unchanged.
   */
  readonly maxAgeDays?: number | null;
  /**
   * Per-call override for recency decay. `true`/`false` toggles
   * `config.ranking.recency.enabled` for this call only. The half-life is
   * preserved from the persistent config.
   */
  readonly recencyEnabled?: boolean;
  /** Optional clock injection for deterministic tests. Defaults to `new Date()`. */
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

/**
 * Run the full pipeline on a pool of normalized jobs from all adapters.
 *
 * Composition: normalize -> dedupe -> filter -> rank. The corpus + alias map +
 * canonical tokenizer required by rank's BM25F scorer are built ONCE over the
 * post-filter pool and passed through. The caller takes the top K
 * (config.ranking.digestK) of the returned list.
 *
 * Per-call `overrides` produce an EFFECTIVE config that wins over the
 * persistent config for the duration of this call only — no disk writes, no
 * mutation of the caller's config object.
 */
export async function runPipeline(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  overrides: PipelineOverrides = {},
): Promise<readonly RankedJob[]> {
  const effectiveRanking = applyOverrides(config.ranking, overrides);
  const effectiveConfig: JobDigestConfig = { ...config, ranking: effectiveRanking };
  const now = overrides.now ?? new Date();

  const normalized = await normalize(jobs);
  const deduped = await dedupe(normalized);
  const filtered = await filter(deduped, effectiveConfig, now);
  const precomputed = buildRankPrecomputed(filtered, effectiveConfig);
  const ranked = await rank(filtered, effectiveConfig, precomputed, now);
  return ranked;
}
