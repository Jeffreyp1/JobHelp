import { bundleTriage } from '../../core/applications/triage.js';
import type { JobDigestConfig } from '../../core/types/config.js';
import { err, ok, type Result } from '../../core/types/result.js';
import type { GetTriageListArgs, GetTriageListResult, ToolError } from './tools-types.js';

export const TRIAGE_DIRECTIVE =
  'This is the FUNNEL SKIM list: one compact line per ranked job so EVERY job gets an AI look. ' +
  'Chunk lines by triage.chunkSize, judge each chunk with a subagent running triage.model against the ' +
  'profileCard (Stage-1 dealbreakers first, then coarse strong/solid/borderline/drop tiers), then call ' +
  'rerank_top_jobs({ jobIds: survivors }) for the full-description deep pass. Never present triage lines ' +
  'directly to the user.';

export async function handleGetTriageList(
  config: JobDigestConfig,
  args: GetTriageListArgs,
): Promise<Result<GetTriageListResult, ToolError>> {
  const opts: { triageK?: number } = {};
  if (args.triageK !== undefined) opts.triageK = args.triageK;
  const bundle = await bundleTriage(config, opts);
  if (!bundle.ok) {
    if (bundle.error.type === 'no_digest') {
      return err({ type: 'not_found', message: bundle.error.message });
    }
    return err({ type: 'io_error', message: bundle.error.message });
  }
  return ok({ ...bundle.value, nextRequiredStep: TRIAGE_DIRECTIVE });
}
