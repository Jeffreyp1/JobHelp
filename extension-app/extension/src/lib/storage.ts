/**
 * storage.ts
 *
 * Type-safe wrapper around chrome.storage.local. All side-panel and
 * background-script code should go through this module instead of touching
 * chrome.storage directly — this keeps storage keys typed against
 * StorageSchema and makes test mocking trivial.
 *
 * Tests can swap in a fake `chrome` object via `installChromeMock()` and the
 * wrapper continues to work transparently.
 */

import type { StorageSchema, StorageKey } from '../types/storage-schema.js';
import { STORAGE_DEFAULTS } from '../types/storage-schema.js';

/** Whether a usable chrome.storage.local is in scope. */
function hasChromeStorage(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  return !!c && !!c.storage && !!c.storage.local;
}

/**
 * Read a single value from storage. If absent, returns the schema default.
 */
export async function get<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
  if (!hasChromeStorage()) {
    return STORAGE_DEFAULTS[key];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  const result = await c.storage.local.get(key);
  if (key in result && result[key] !== undefined) {
    return result[key] as StorageSchema[K];
  }
  return STORAGE_DEFAULTS[key];
}

/** Write a single value to storage. */
export async function set<K extends StorageKey>(
  key: K,
  value: StorageSchema[K],
): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  await c.storage.local.set({ [key]: value });
}

/**
 * Convenience helper: read all known schema keys at once. Missing keys fall
 * back to STORAGE_DEFAULTS. Useful for hydrating the side-panel UI on open.
 */
export async function getAll(): Promise<StorageSchema> {
  if (!hasChromeStorage()) {
    return { ...STORAGE_DEFAULTS };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  const keys = Object.keys(STORAGE_DEFAULTS) as StorageKey[];
  const stored = (await c.storage.local.get(keys)) as Partial<StorageSchema>;
  const merged = { ...STORAGE_DEFAULTS } as StorageSchema;
  for (const k of keys) {
    const v = stored[k];
    if (v !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[k] = v;
    }
  }
  return merged;
}
