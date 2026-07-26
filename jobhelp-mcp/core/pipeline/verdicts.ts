import type { NormalizedJob } from '../types/job.js';
import type { JobVerdictEntry } from '../state/index.js';
import { identityKey, jaccard, normalizeCompany, titleTokenSet } from './identity.js';

const SKIPPED_DEMOTION = 0.5;
const TITLE_JACCARD_THRESHOLD = 0.6;

export interface VerdictPartition {
  readonly suppressedJobIds: ReadonlySet<string>;
  readonly demotions: ReadonlyMap<string, number>;
}

interface PreparedVerdict {
  readonly identityKey: string;
  readonly company: string;
  readonly titleTokens: ReadonlySet<string>;
  readonly verdict: JobVerdictEntry['verdict'];
}

// Match a stored verdict to a job by exact identity OR same normalized company with a
// high title-token overlap. Company-alone never matches: a drop on one role must not
// nuke every role at that company.
function matches(job: PreparedJob, verdict: PreparedVerdict): boolean {
  if (job.identityKey === verdict.identityKey) return true;
  if (job.company.length === 0 || job.company !== verdict.company) return false;
  return jaccard(job.titleTokens, verdict.titleTokens) >= TITLE_JACCARD_THRESHOLD;
}

interface PreparedJob {
  readonly id: string;
  readonly identityKey: string;
  readonly company: string;
  readonly titleTokens: ReadonlySet<string>;
}

export function partitionByVerdict(
  jobs: readonly NormalizedJob[],
  verdicts: readonly JobVerdictEntry[],
): VerdictPartition {
  const suppressedJobIds = new Set<string>();
  const demotions = new Map<string, number>();
  const actionable = verdicts.filter((v) => v.verdict === 'drop' || v.verdict === 'skipped');
  if (actionable.length === 0) return { suppressedJobIds, demotions };
  const prepared: readonly PreparedVerdict[] = actionable.map((v) => ({
    identityKey: v.identityKey,
    company: normalizeCompany(v.company),
    titleTokens: titleTokenSet(v.title),
    verdict: v.verdict,
  }));
  for (const job of jobs) {
    const pj: PreparedJob = {
      id: job.id,
      identityKey: identityKey(job.company, job.title),
      company: normalizeCompany(job.company),
      titleTokens: titleTokenSet(job.title),
    };
    let drop = false;
    let skip = false;
    for (const v of prepared) {
      if (!matches(pj, v)) continue;
      if (v.verdict === 'drop') {
        drop = true;
        break;
      }
      skip = true;
    }
    if (drop) {
      suppressedJobIds.add(job.id);
    } else if (skip) {
      demotions.set(job.id, SKIPPED_DEMOTION);
    }
  }
  return { suppressedJobIds, demotions };
}
