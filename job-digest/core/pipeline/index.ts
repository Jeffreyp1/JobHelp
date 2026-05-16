import type { JobDigestConfig, NormalizedJob, RankedJob } from '../types/index.js';
import { normalize } from './normalize.js';
import { dedupe } from './dedupe.js';
import { filter } from './filter.js';
import { rank } from './rank.js';

/**
 * Run the full pipeline on a pool of normalized jobs from all adapters.
 *
 * Composition: normalize -> dedupe -> filter -> rank.
 * The caller takes the top K (config.ranking.digestK) of the returned list.
 */
export async function runPipeline(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly RankedJob[]> {
  const normalized = await normalize(jobs);
  const deduped = await dedupe(normalized);
  const filtered = await filter(deduped, config);
  const ranked = await rank(filtered, config);
  return ranked;
}
