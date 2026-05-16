import type { JobDigestConfig, NormalizedJob, RankedJob } from '../types/index.js';
import { normalize } from './normalize.js';
import { dedupe } from './dedupe.js';
import { filter } from './filter.js';
import { rank, buildRankPrecomputed } from './rank.js';

/**
 * Run the full pipeline on a pool of normalized jobs from all adapters.
 *
 * Composition: normalize -> dedupe -> filter -> rank.
 * The corpus + alias map + canonical tokenizer required by rank's BM25F scorer
 * are built ONCE over the post-filter pool and passed through. The caller
 * takes the top K (config.ranking.digestK) of the returned list.
 */
export async function runPipeline(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly RankedJob[]> {
  const normalized = await normalize(jobs);
  const deduped = await dedupe(normalized);
  const filtered = await filter(deduped, config);
  const precomputed = buildRankPrecomputed(filtered, config);
  const ranked = await rank(filtered, config, precomputed);
  return ranked;
}
