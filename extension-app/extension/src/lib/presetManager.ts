/**
 * presetManager.ts
 *
 * CRUD around the user's named toggle/model presets. Backed by
 * chrome.storage.local under the "presets" key (per StorageSchema).
 *
 * Save with an existing name overwrites in place — there is no
 * version history. Names are case-sensitive.
 */

import type { StoredPreset } from '../types/storage-schema.js';

const KEY = 'presets';

function hasChromeStorage(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  return !!c && !!c.storage && !!c.storage.local;
}

async function readAll(): Promise<StoredPreset[]> {
  if (!hasChromeStorage()) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  const stored = (await c.storage.local.get(KEY)) as Record<string, unknown>;
  const list = stored[KEY];
  if (!Array.isArray(list)) return [];
  return list as StoredPreset[];
}

async function writeAll(list: StoredPreset[]): Promise<void> {
  if (!hasChromeStorage()) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  await c.storage.local.set({ [KEY]: list });
}

export class PresetManager {
  /** Save a preset. Overwrites by name if one already exists. */
  async save(preset: StoredPreset): Promise<void> {
    const list = await readAll();
    const idx = list.findIndex((p) => p.name === preset.name);
    if (idx >= 0) {
      list[idx] = preset;
    } else {
      list.push(preset);
    }
    await writeAll(list);
  }

  /** Look up a preset by name; returns null if not found. */
  async load(name: string): Promise<StoredPreset | null> {
    const list = await readAll();
    return list.find((p) => p.name === name) ?? null;
  }

  /** Return all saved presets (a fresh copy — callers may mutate freely). */
  async list(): Promise<StoredPreset[]> {
    const list = await readAll();
    return [...list];
  }

  /** Remove a preset by name. No-op if not present. */
  async delete(name: string): Promise<void> {
    const list = await readAll();
    const next = list.filter((p) => p.name !== name);
    await writeAll(next);
  }
}
