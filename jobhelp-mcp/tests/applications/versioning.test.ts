import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fileNameForKind,
  listVersions,
  nextVersion,
} from '../../core/applications/versioning.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobhelp-versioning-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fileNameForKind', () => {
  it('versioned kinds embed version number', () => {
    expect(fileNameForKind('resume', 1)).toBe('resume.v1.md');
    expect(fileNameForKind('resume', 7)).toBe('resume.v7.md');
    expect(fileNameForKind('cover-letter', 2)).toBe('cover-letter.v2.md');
  });

  it('overwrite kinds ignore version', () => {
    expect(fileNameForKind('critique', 99)).toBe('critique.md');
    expect(fileNameForKind('notes', 1)).toBe('notes.md');
  });
});

describe('nextVersion', () => {
  it('returns 1 for an empty directory (versioned kind)', async () => {
    await expect(nextVersion(dir, 'resume')).resolves.toBe(1);
  });

  it('returns 1 for a non-existent directory', async () => {
    const missing = join(dir, 'does-not-exist');
    await expect(nextVersion(missing, 'resume')).resolves.toBe(1);
  });

  it('finds the highest existing version + 1', async () => {
    writeFileSync(join(dir, 'resume.v1.md'), 'x');
    writeFileSync(join(dir, 'resume.v2.md'), 'x');
    writeFileSync(join(dir, 'resume.v3.md'), 'x');
    await expect(nextVersion(dir, 'resume')).resolves.toBe(4);
  });

  it('handles non-contiguous versions', async () => {
    writeFileSync(join(dir, 'resume.v1.md'), 'x');
    writeFileSync(join(dir, 'resume.v5.md'), 'x');
    await expect(nextVersion(dir, 'resume')).resolves.toBe(6);
  });

  it('does not confuse different kinds in the same dir', async () => {
    writeFileSync(join(dir, 'resume.v1.md'), 'x');
    writeFileSync(join(dir, 'cover-letter.v1.md'), 'x');
    writeFileSync(join(dir, 'cover-letter.v2.md'), 'x');
    await expect(nextVersion(dir, 'resume')).resolves.toBe(2);
    await expect(nextVersion(dir, 'cover-letter')).resolves.toBe(3);
  });

  it('always returns 1 for non-versioned kinds (overwrite)', async () => {
    writeFileSync(join(dir, 'critique.md'), 'old');
    await expect(nextVersion(dir, 'critique')).resolves.toBe(1);
    await expect(nextVersion(dir, 'notes')).resolves.toBe(1);
  });

  it('ignores files with non-numeric versions', async () => {
    writeFileSync(join(dir, 'resume.vXYZ.md'), 'x');
    writeFileSync(join(dir, 'resume.v2.md'), 'x');
    await expect(nextVersion(dir, 'resume')).resolves.toBe(3);
  });
});

describe('listVersions', () => {
  it('returns versions sorted ascending for versioned kinds', async () => {
    writeFileSync(join(dir, 'resume.v3.md'), 'x');
    writeFileSync(join(dir, 'resume.v1.md'), 'x');
    writeFileSync(join(dir, 'resume.v2.md'), 'x');
    const versions = await listVersions(dir, 'resume');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[0]?.fileName).toBe('resume.v1.md');
    expect(versions[0]?.path).toBe(join(dir, 'resume.v1.md'));
  });

  it('returns single synthetic entry for non-versioned kinds', async () => {
    const versions = await listVersions(dir, 'critique');
    expect(versions).toEqual([
      { version: 1, fileName: 'critique.md', path: join(dir, 'critique.md'), writtenAt: '' },
    ]);
  });

  it('returns empty array when versioned kind has no files', async () => {
    const versions = await listVersions(dir, 'resume');
    expect(versions).toEqual([]);
  });
});
