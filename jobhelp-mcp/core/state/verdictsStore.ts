import { updateState } from './store.js';
import type { JobHelpState, JobVerdictEntry, StateError } from './index.js';
import { err, ok, type Result } from '../types/result.js';

// Keep the verdict ledger bounded; oldest by `at` are evicted first.
export const VERDICT_RETENTION_CAP = 2000;

function upsertAndCap(
  existing: readonly JobVerdictEntry[],
  incoming: readonly JobVerdictEntry[],
): readonly JobVerdictEntry[] {
  const byKey = new Map<string, JobVerdictEntry>();
  for (const entry of existing) byKey.set(entry.identityKey, entry);
  // Incoming is the latest action: later writes win, including duplicates within the batch.
  for (const entry of incoming) byKey.set(entry.identityKey, entry);
  const merged = [...byKey.values()];
  if (merged.length <= VERDICT_RETENTION_CAP) return merged;
  merged.sort((a, b) => a.at.localeCompare(b.at));
  return merged.slice(merged.length - VERDICT_RETENTION_CAP);
}

export async function recordVerdicts(
  entries: readonly JobVerdictEntry[],
): Promise<Result<JobHelpState, StateError>> {
  if (entries.length === 0) {
    return err({ type: 'validation', message: 'recordVerdicts requires at least one entry' });
  }
  return updateState((state: JobHelpState) => ({
    ...state,
    verdicts: upsertAndCap(state.verdicts ?? [], entries),
  }));
}
