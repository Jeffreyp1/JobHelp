import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const BUNDLED: Record<string, string[]> = {
  'greenhouse.json': ['alpha', 'beta', 'g1', 'g2', 'g3'],
  'ashby.json': ['ashby-bundled'],
  'breezy.json': [],
  'personio.json': [],
  'pinpoint.json': [],
  'recruitee.json': [],
  'smartrecruiters.json': [],
  'teamtailor.json': [],
  'workable.json': [],
  'lever.json': ['lever-bundled'],
};

function mockBundledLists(): void {
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
    return {
      ...actual,
      readFile: async (path: Parameters<typeof actual.readFile>[0]) => {
        const p = path.toString();
        const marker = `${sep}company-lists${sep}`;
        const at = p.lastIndexOf(marker);
        if (at !== -1) {
          const fixture = BUNDLED[p.slice(at + marker.length)];
          if (fixture !== undefined) return JSON.stringify(fixture);
        }
        return actual.readFile(p, 'utf8');
      },
    };
  });
}

async function importFresh() {
  mockBundledLists();
  const sources = await import('../../core/init/companySources.js');
  const logs = await import('../../core/lib/log.js');
  logs.__resetForTests();
  return { sources, logs };
}

function mkConfigDir(userFile?: Record<string, unknown>): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jobhelp-union-'));
  if (userFile !== undefined) {
    writeFileSync(join(dir, 'company-sources.json'), JSON.stringify(userFile, null, 2) + '\n');
  }
  return { dir, configPath: join(dir, 'config.json') };
}

function findMergeLog(logs: Awaited<ReturnType<typeof importFresh>>['logs']) {
  return logs
    .getRecentLogs()
    .find((e) => e.level === 'info' && e.msg.includes('company-sources'));
}

describe('loadCompanySourcesForConfig — union merge with bundled lists', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('unions bundled tokens into the user file, preserving user extras, and logs the delta', async () => {
    const { dir, configPath } = mkConfigDir({
      greenhouse: { tokens: ['alpha', 'beta', 'user-extra'] },
    });
    const { sources, logs } = await importFresh();
    try {
      const merged = await sources.loadCompanySourcesForConfig(configPath);

      expect(merged?.greenhouse?.tokens).toEqual([
        'alpha',
        'beta',
        'user-extra',
        'g1',
        'g2',
        'g3',
      ]);

      const entry = findMergeLog(logs);
      expect(entry).toBeDefined();
      expect(entry?.ctx?.['deltas']).toMatchObject({
        greenhouse: { before: 3, after: 6, added: 3 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists the union to disk, adds bundled-only sources, and preserves unknown keys', async () => {
    const { dir, configPath } = mkConfigDir({
      greenhouse: { tokens: ['alpha', 'user-extra'] },
      note: 'keep-me',
    });
    const { sources } = await importFresh();
    try {
      const merged = await sources.loadCompanySourcesForConfig(configPath);
      expect(merged?.ashby?.tokens).toEqual(['ashby-bundled']);
      expect(merged?.lever?.slugs).toEqual(['lever-bundled']);

      const onDisk = JSON.parse(readFileSync(join(dir, 'company-sources.json'), 'utf8')) as {
        greenhouse?: { tokens?: string[] };
        ashby?: { tokens?: string[] };
        lever?: { slugs?: string[] };
        note?: string;
      };
      expect(onDisk.greenhouse?.tokens).toEqual([
        'alpha',
        'user-extra',
        'beta',
        'g1',
        'g2',
        'g3',
      ]);
      expect(onDisk.ashby?.tokens).toEqual(['ashby-bundled']);
      expect(onDisk.lever?.slugs).toEqual(['lever-bundled']);
      expect(onDisk.note).toBe('keep-me');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op on the second load: no merge log, file byte-identical', async () => {
    const { dir, configPath } = mkConfigDir({
      greenhouse: { tokens: ['alpha'] },
    });
    const { sources, logs } = await importFresh();
    try {
      await sources.loadCompanySourcesForConfig(configPath);
      const afterFirst = readFileSync(join(dir, 'company-sources.json'), 'utf8');

      logs.__resetForTests();
      const merged = await sources.loadCompanySourcesForConfig(configPath);

      expect(findMergeLog(logs)).toBeUndefined();
      expect(readFileSync(join(dir, 'company-sources.json'), 'utf8')).toBe(afterFirst);
      expect(merged?.greenhouse?.tokens).toEqual(['alpha', 'beta', 'g1', 'g2', 'g3']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes repeated tokens in the user file', async () => {
    const { dir, configPath } = mkConfigDir({
      greenhouse: { tokens: ['dup', 'dup'] },
    });
    const { sources } = await importFresh();
    try {
      const merged = await sources.loadCompanySourcesForConfig(configPath);
      expect(merged?.greenhouse?.tokens).toEqual(['dup', 'alpha', 'beta', 'g1', 'g2', 'g3']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still returns undefined when no company-sources.json exists', async () => {
    const { dir, configPath } = mkConfigDir();
    const { sources } = await importFresh();
    try {
      const merged = await sources.loadCompanySourcesForConfig(configPath);
      expect(merged).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
