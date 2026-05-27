import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDefaults, loadUserRules } from '../../core/rules/loader.js';
import { isOk } from '../../core/types/result.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'jobhelp-rules-test-'));
}

describe('loadDefaults', () => {
  it('returns exactly 15 bundled rule files', async () => {
    const result = await loadDefaults();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.length).toBe(15);
  });

  it('each rule has id, filename, and non-empty content', async () => {
    const result = await loadDefaults();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    for (const r of result.value) {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.filename).toMatch(/^[0-9]{2}-.+\.md$/);
      expect(r.content.length).toBeGreaterThan(0);
    }
  });

  it('filenames are sorted ascending (01- ... 15-)', async () => {
    const result = await loadDefaults();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const names = result.value.map((r) => r.filename);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
    expect(names[0]).toBe('01-priority-hierarchy.md');
    expect(names[14]).toBe('15-cl-tones.md');
  });

  it('id derives from filename stem (no .md)', async () => {
    const result = await loadDefaults();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    for (const r of result.value) {
      expect(r.id).toBe(r.filename.replace(/\.md$/, ''));
    }
  });

  it('re-reads from disk on every call (no cache)', async () => {
    const a = await loadDefaults();
    const b = await loadDefaults();
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value).not.toBe(b.value);
    expect(a.value.length).toBe(b.value.length);
  });
});

describe('loadUserRules', () => {
  it('returns empty array when dir does not exist', async () => {
    const missing = join(tmpdir(), `jobhelp-missing-${Date.now()}`);
    const result = await loadUserRules(missing);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.length).toBe(0);
  });

  it('returns empty array when dir is empty', async () => {
    const dir = await makeTempDir();
    try {
      const result = await loadUserRules(dir);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads only .md files, sorted by filename', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile(join(dir, '02-custom.md'), '# Custom 2', 'utf8');
      await writeFile(join(dir, '01-mine.md'), '# Custom 1', 'utf8');
      await writeFile(join(dir, 'ignore.txt'), 'not markdown', 'utf8');
      const result = await loadUserRules(dir);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.map((r) => r.filename)).toEqual(['01-mine.md', '02-custom.md']);
      expect(result.value[0]?.content).toBe('# Custom 1');
      expect(result.value[1]?.content).toBe('# Custom 2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('expands ~ to home directory', async () => {
    const result = await loadUserRules('~/__definitely_missing_jobhelp_dir__');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.length).toBe(0);
  });

  it('skips subdirectories', async () => {
    const dir = await makeTempDir();
    try {
      await mkdir(join(dir, 'nested'));
      await writeFile(join(dir, 'nested', '01-nested.md'), '# nested', 'utf8');
      await writeFile(join(dir, '01-top.md'), '# top', 'utf8');
      const result = await loadUserRules(dir);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0]?.filename).toBe('01-top.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
