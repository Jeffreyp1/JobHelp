/**
 * Job ranking: score DiscoveredJob[] against a JobProfile.
 *
 * STUB — the J2 agent implements this.
 *   Stage A (free): weighted keyword overlap between JD and profile.skills.
 *   Stage B (optional, cheap Claude call): semantic fit on the survivors.
 *   final = fit (or keyword if no fit) * recencyBoost.
 */

import type { DiscoveredJob, JobProfile, RankedJob } from '../types/job-discovery.js';
import type { ClaudeClient } from '../types/claude-api.js';
import type { CostBreakdown } from '../types/api-contract.js';

/**
 * Rank `jobs` against `profile`. If `claude` + `fitScoreModel` are provided,
 * run the Stage-B fit score on the top survivors; otherwise rank by keyword
 * overlap * recency only. `maxDaysOld` of 0 means no recency hard-filter.
 * Returns the ranked list (descending finalScore) plus accumulated cost.
 */
export function rankJobs(
  _jobs: DiscoveredJob[],
  _profile: JobProfile,
  _opts: { maxDaysOld: number; topN: number; claude?: ClaudeClient; fitScoreModel?: string },
): { ranked: RankedJob[]; cost: CostBreakdown } {
  throw new Error('jobRanking.rankJobs: not implemented (J2 agent)');
}
