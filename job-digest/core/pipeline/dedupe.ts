import type { NormalizedJob } from '../types/index.js';

// v0: exact-id dedupe only; first occurrence wins.
// TODO_FUTURE: URL canonicalization + title+company hash (spec §5 future-dedup).
export async function dedupe(
  jobs: readonly NormalizedJob[],
): Promise<readonly NormalizedJob[]> {
  const seen = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    if (!seen.has(job.id)) {
      seen.set(job.id, job);
    }
  }
  return Array.from(seen.values());
}
