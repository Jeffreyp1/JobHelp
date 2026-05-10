import { describe, it, expect, beforeEach } from 'vitest';
import { PresetManager } from '../../src/lib/presetManager';
import { installChromeMock } from '../helpers/chrome-mocks';
import type { StoredPreset } from '../../src/types/storage-schema.js';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

function makePreset(name: string, model: string = HAIKU): StoredPreset {
  return {
    name,
    config: {
      research: { enabled: false, model: HAIKU },
    },
    generateModel: model,
  };
}

describe('presetManager', () => {
  let mgr: PresetManager;

  beforeEach(() => {
    installChromeMock();
    mgr = new PresetManager();
  });

  it('T6: save({name, config}) writes to chrome.storage.local under "presets"', async () => {
    const preset = makePreset('default');
    await mgr.save(preset);

    const stored = await chrome.storage.local.get('presets');
    expect(stored.presets).toBeDefined();
    expect(Array.isArray(stored.presets)).toBe(true);
    const arr = stored.presets as StoredPreset[];
    expect(arr.find((p) => p.name === 'default')).toEqual(preset);
  });

  it('T7: load(name) returns the saved config', async () => {
    const preset = makePreset('budget');
    await mgr.save(preset);
    const loaded = await mgr.load('budget');
    expect(loaded).toEqual(preset);
  });

  it('T8: list() returns array of saved presets', async () => {
    await mgr.save(makePreset('a'));
    await mgr.save(makePreset('b', SONNET));
    const list = await mgr.list();
    expect(list.length).toBe(2);
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('T9: delete(name) removes a preset', async () => {
    await mgr.save(makePreset('to-keep'));
    await mgr.save(makePreset('to-delete'));
    await mgr.delete('to-delete');

    const list = await mgr.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('to-keep');

    const gone = await mgr.load('to-delete');
    expect(gone).toBeNull();
  });

  it('T10: save with existing name overwrites', async () => {
    const initial = makePreset('main', HAIKU);
    await mgr.save(initial);

    const updated: StoredPreset = {
      name: 'main',
      config: { critique: { enabled: true, model: SONNET } },
      generateModel: SONNET,
    };
    await mgr.save(updated);

    const list = await mgr.list();
    expect(list.length).toBe(1);
    expect(list[0]).toEqual(updated);
    expect(list[0].generateModel).toBe(SONNET);
  });
});
