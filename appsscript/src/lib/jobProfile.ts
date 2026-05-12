/**
 * Profile distillation: source materials -> JobProfile via a Claude call.
 *
 * STUB — the J2 agent implements this.
 */

import type { JobProfile } from '../types/job-discovery.js';
import type { ClaudeClient } from '../types/claude-api.js';
import type { CostBreakdown } from '../types/api-contract.js';

/**
 * Distil the user's source-materials text into a JobProfile (titles, skills,
 * domains, search queries, filters, a ~200-word summary) using one Claude call.
 */
export function distilProfile(
  _claude: ClaudeClient,
  _model: string,
  _sourceMaterialsText: string,
): { profile: JobProfile; cost: CostBreakdown } {
  throw new Error('jobProfile.distilProfile: not implemented (J2 agent)');
}
