/**
 * Persisted-digest cache. The Jobs tab's discover-and-rank result is cached to
 * chrome.storage so closing and re-opening the side panel doesn't lose it (and
 * doesn't force a fresh paid discovery run).
 */
import { get, set } from './storage.js';
import { log } from './structuredLog.js';
import type { DiscoverAndRankResult } from '../types/api-contract.js';
import type { CachedDigest } from '../types/storage-schema.js';

/**
 * Persist a digest result, stamped with the current time. Best-effort: a
 * storage failure is logged and swallowed so it never blocks the result the
 * user already holds in hand.
 */
export async function saveDigest(result: DiscoverAndRankResult): Promise<void> {
  try {
    await set('lastDigest', { result, savedAt: Date.now() });
  } catch (error) {
    log('warn', 'digest cache write failed', { error });
  }
}

/** Read the last cached digest, or null if none was saved / on a read failure. */
export async function loadDigest(): Promise<CachedDigest | null> {
  try {
    return await get('lastDigest');
  } catch (error) {
    log('warn', 'digest cache read failed', { error });
    return null;
  }
}
