import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { lever } from '../../core/sources/lever.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'lever-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function makeConfig(slugs: readonly string[] = ['examplecorp']): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: [],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'entry',
      roleFamily: ['backend'],
    },
    sources: { lever: { slugs } },
    ranking: { useLlmFitScore: false, topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}
describe('lever adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="lever"', () => {
    expect(lever.name).toBe('lever');
  });

  describe('enabled()', () => {
    it('returns true when at least one slug is configured', () => {
      expect(lever.enabled(makeConfig(['anthropic']))).toBe(true);
    });

    it('returns false when slugs array is empty', () => {
      expect(lever.enabled(makeConfig([]))).toBe(false);
    });

    it('returns false when lever config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(lever.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] with correct shape', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await lever.fetch(makeConfig(['examplecorp']));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('lever:0123abcd-4567-89ef-0123-456789abcdef');
      expect(first.source).toBe('lever');
      expect(first.url).toBe('https://jobs.lever.co/examplecorp/0123abcd-4567-89ef-0123-456789abcdef');
      expect(first.title).toBe('Staff Software Engineer');
      expect(first.company).toBe('examplecorp');
      expect(first.location).toBe('Remote - North America');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(220000);
      expect(first.salaryMax).toBe(280000);
      expect(first.salaryCurrency).toBe('USD');
      expect(first.postedAt).toBeDefined();
      expect(first.description.length).toBeGreaterThan(0);
      expect(first.rawSourceData).toBeDefined();
    });
    it('detects hybrid workplaceType', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await lever.fetch(makeConfig(['examplecorp']));
      const second = jobs[1];
      if (!second) throw new Error('expected job 1');
      expect(second.remote).toBe('hybrid');
      expect(second.location).toBe('San Francisco, CA');
      expect(second.salaryMin).toBeUndefined();
    });

    it('iterates slugs and aggregates', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await lever.fetch(makeConfig(['a', 'b']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(4);
    });

    it('builds correct URL per slug', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await lever.fetch(makeConfig(['examplecorp']));
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      expect(String(call[0])).toBe('https://api.lever.co/v0/postings/examplecorp?mode=json');
    });
    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('rate limited', { status: 429 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(lever.fetch(makeConfig(['examplecorp']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=network on 500', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('boom', { status: 500 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(lever.fetch(makeConfig(['examplecorp']))).rejects.toMatchObject({ type: 'network' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('not json', { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(lever.fetch(makeConfig(['examplecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when body is not an array', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ not: 'array' }), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(lever.fetch(makeConfig(['examplecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when lever config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(lever.fetch(cfg)).rejects.toThrow();
    });

    it('skips malformed posting entries', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify([{ id: 'a', text: 't', hostedUrl: 'http://x', descriptionPlain: 'd', categories: { location: 'L' } }, null, { text: 'bad' }, 'string-entry']), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await lever.fetch(makeConfig(['examplecorp']));
      expect(jobs).toHaveLength(1);
    });

    it('continues to next slug when first slug fails (partial-failure recovery)', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => Promise.resolve(new Response('boom', { status: 500 })))
        .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await lever.fetch(makeConfig(['fails', 'examplecorp']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs.length).toBeGreaterThan(0);
      for (const j of jobs) expect(j.company).toBe('examplecorp');
    });
  });
});
