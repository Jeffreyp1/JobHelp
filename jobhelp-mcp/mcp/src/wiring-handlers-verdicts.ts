import { getLatestDigest } from '../../core/state/digestStore.js';
import { recordVerdicts } from '../../core/state/verdictsStore.js';
import { identityKey } from '../../core/pipeline/identity.js';
import type { JobVerdictEntry } from '../../core/state/index.js';
import { err, ok, type Result } from '../../core/types/result.js';
import type {
  RecordJobVerdictsArgs,
  RecordJobVerdictsResult,
  ToolError,
} from './tools-types.js';
import { toToolError } from './wiring-helpers.js';

export async function handleRecordJobVerdicts(
  args: RecordJobVerdictsArgs,
): Promise<Result<RecordJobVerdictsResult, ToolError>> {
  const latest = await getLatestDigest();
  if (!latest.ok) {
    if (latest.error.type === 'not_found') {
      return err({ type: 'not_found', message: latest.error.message });
    }
    return err(toToolError(latest.error));
  }
  const byId = new Map(latest.value.jobs.map((r) => [r.job.id, r.job] as const));
  const nowIso = new Date().toISOString();
  const entries: JobVerdictEntry[] = [];
  const unresolvedIds: string[] = [];
  for (const v of args.verdicts) {
    const job = byId.get(v.jobId);
    if (job === undefined) {
      unresolvedIds.push(v.jobId);
      continue;
    }
    entries.push({
      identityKey: identityKey(job.company, job.title),
      jobId: v.jobId,
      company: job.company,
      title: job.title,
      url: job.url,
      verdict: v.verdict,
      at: nowIso,
      ...(v.reason !== undefined ? { reason: v.reason } : {}),
    });
  }
  if (entries.length > 0) {
    const write = await recordVerdicts(entries);
    if (!write.ok) return err({ type: 'io_error', message: write.error.message });
  }
  return ok({ recorded: entries.length, unresolvedIds });
}
