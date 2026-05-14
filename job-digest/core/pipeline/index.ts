/**
 * Pipeline orchestrator. Agent B populates: composes normalize → filter → dedupe → rank.
 */
import type { JobDigestConfig, NormalizedJob, RankedJob } from '../types/index.js';

/**
 * Run the full pipeline on a pool of normalized jobs from all adapters.
 * Agent B owns the real implementation.
 *
 * @param jobs - raw jobs from all source adapters, concatenated
 * @param config - user config (drives filter thresholds and ranking weights)
 * @returns ranked jobs, longest list first; caller takes top K
 */
export async function runPipeline(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly RankedJob[]> {
  void jobs;
  void config;
  throw new Error('runPipeline() not implemented — Agent B owns core/pipeline/index.ts');
}
