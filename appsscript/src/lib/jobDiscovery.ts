/**
 * Job-discovery library: poll configured sources, normalise to DiscoveredJob[].
 *
 * STUB — the J1 agent implements this. The function signatures below are the
 * contract J4's discoverAndRank handler codes against.
 */

import type { DiscoveredJob, DiscoveryConfig } from '../types/job-discovery.js';

/**
 * Fetch postings from every enabled source in `config`, normalise each to the
 * common DiscoveredJob shape, and return the merged (NOT yet deduped) list.
 * Errors from one source must not abort the others — log and continue.
 */
export function discoverJobs(_config: DiscoveryConfig): DiscoveredJob[] {
  throw new Error('jobDiscovery.discoverJobs: not implemented (J1 agent)');
}

/** Dedup by DiscoveredJob.id, keeping the entry with the more complete description. */
export function dedupJobs(jobs: DiscoveredJob[]): DiscoveredJob[] {
  const byId = new Map<string, DiscoveredJob>();
  for (const j of jobs) {
    const existing = byId.get(j.id);
    if (!existing || j.descriptionText.length > existing.descriptionText.length) {
      byId.set(j.id, j);
    }
  }
  return [...byId.values()];
}
