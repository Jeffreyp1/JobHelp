import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readLatestDigestUrls, sampleCandidates } from '../src/canary-sample.ts';

const atsOf = (url: string): string | null =>
  url.includes('ashby') ? 'ashby' : url.includes('lever') ? 'lever' : null;

describe('sampleCandidates', () => {
  it('prefers queue urls, tops up from the digest, dedupes, caps per ats', () => {
    const out = sampleCandidates({
      applications: [{ url: 'https://ashby/a1' }, { url: 'https://ashby/a2' }, {}, { url: 'https://nowhere/x' }],
      digestUrls: ['https://ashby/a2', 'https://ashby/a3', 'https://ashby/a4', 'https://ashby/a5', 'https://lever/l1'],
      atsOf,
    });
    expect(out['ashby']).toEqual(['https://ashby/a1', 'https://ashby/a2', 'https://ashby/a3', 'https://ashby/a4']);
    expect(out['lever']).toEqual(['https://lever/l1']);
    expect(out['nowhere']).toBeUndefined();
  });

  it('returns an empty record when there is nothing to sample', () => {
    expect(sampleCandidates({ applications: [], digestUrls: [], atsOf })).toEqual({});
  });
});

describe('readLatestDigestUrls', () => {
  it('reads urls via a date pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhelp-digest-'));
    await mkdir(join(root, 'digests'), { recursive: true });
    await writeFile(join(root, 'digests', 'latest.json'), JSON.stringify({ date: '2026-07-19' }));
    await writeFile(
      join(root, 'digests', 'digest-2026-07-19.json'),
      JSON.stringify({ date: '2026-07-19', jobs: [{ url: 'https://ashby/a1' }, { url: 'https://lever/l1' }, { title: 'no url' }] }),
    );
    expect(await readLatestDigestUrls(root)).toEqual(['https://ashby/a1', 'https://lever/l1']);
  });

  it('reads urls when the pointer IS the digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhelp-digest-'));
    await mkdir(join(root, 'digests'), { recursive: true });
    await writeFile(join(root, 'digests', 'latest.json'), JSON.stringify({ jobs: [{ url: 'https://ashby/a9' }] }));
    expect(await readLatestDigestUrls(root)).toEqual(['https://ashby/a9']);
  });

  it('returns [] for missing or malformed digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhelp-digest-'));
    expect(await readLatestDigestUrls(root)).toEqual([]);
    await mkdir(join(root, 'digests'), { recursive: true });
    await writeFile(join(root, 'digests', 'latest.json'), '{broken');
    expect(await readLatestDigestUrls(root)).toEqual([]);
  });
});
