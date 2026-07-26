import { bundleTriage } from '../../core/applications/triage.js';
import { appliedJobIds } from '../../core/pipeline/history.js';
import { readState } from '../../core/state/index.js';
import { getLatestDigest } from '../../core/state/digestStore.js';
import { log } from '../../core/lib/log.js';
import type { JobDigestConfig } from '../../core/types/config.js';
import { err, ok, type Result } from '../../core/types/result.js';
import type { GetTriageListArgs, GetTriageListResult, ToolError } from './tools-types.js';

export const TRIAGE_DIRECTIVE =
  'This is the FUNNEL SKIM list: one compact line per ranked job so EVERY job gets an AI look. ' +
  'Chunk lines by triage.chunkSize, judge each chunk with a subagent running triage.model against the ' +
  'profileCard (Stage-1 dealbreakers first, then coarse strong/solid/borderline/drop tiers), then call ' +
  'rerank_top_jobs({ jobIds: survivors }) for the full-description deep pass. Never present triage lines ' +
  'directly to the user.';

// The applied set is computed against the persisted digest so already-applied
// jobs get an APPLIED marker; only consulted when ranking.history is enabled.
async function appliedIdsFromState(): Promise<ReadonlySet<string> | undefined> {
  const state = await readState();
  if (!state.ok) {
    log('warn', 'get_triage_list.history.state_unavailable', { error: state.error });
    return undefined;
  }
  if (state.value.applications.length === 0) return undefined;
  const latest = await getLatestDigest();
  if (!latest.ok) return undefined;
  return appliedJobIds(
    latest.value.jobs.map((r) => r.job),
    state.value.applications,
  );
}

export async function handleGetTriageList(
  config: JobDigestConfig,
  args: GetTriageListArgs,
): Promise<Result<GetTriageListResult, ToolError>> {
  const opts: { triageK?: number; appliedJobIds?: ReadonlySet<string> } = {};
  if (args.triageK !== undefined) opts.triageK = args.triageK;
  if (config.ranking.history?.enabled === true) {
    const applied = await appliedIdsFromState();
    if (applied !== undefined) opts.appliedJobIds = applied;
  }
  const bundle = await bundleTriage(config, opts);
  if (!bundle.ok) {
    if (bundle.error.type === 'no_digest') {
      return err({ type: 'not_found', message: bundle.error.message });
    }
    return err({ type: 'io_error', message: bundle.error.message });
  }
  return ok({ ...bundle.value, nextRequiredStep: TRIAGE_DIRECTIVE });
}
