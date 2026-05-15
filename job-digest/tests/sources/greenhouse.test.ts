import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { greenhouse } from '../../core/sources/greenhouse.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'greenhouse-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function makeConfig(tokens: readonly string[] = ['acmecorp']): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: [],
      location: 'Irvine, CA',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'entry',
      roleFamily: ['backend'],
    },
    sources: { greenhouse: { tokens } },
    ranking: { useLlmFitScore: false, topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}
describe('greenhouse adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="greenhouse"', () => {
    expect(greenhouse.name).toBe('greenhouse');
  });

  describe('enabled()', () => {
    it('returns true when at least one token is configured', () => {
      expect(greenhouse.enabled(makeConfig(['acmecorp']))).toBe(true);
    });

    it('returns false when tokens array is empty', () => {
      expect(greenhouse.enabled(makeConfig([]))).toBe(false);
    });

    it('returns false when greenhouse config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(greenhouse.enabled(cfg)).toBe(false);
    });
  });
  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single token', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await greenhouse.fetch(makeConfig(['acmecorp']));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('greenhouse:5678901');
      expect(first.source).toBe('greenhouse');
      expect(first.url).toBe('https://boards.greenhouse.io/acmecorp/jobs/5678901');
      expect(first.title).toBe('Senior Backend Engineer');
      expect(first.company).toBe('acmecorp');
      expect(first.location).toBe('Remote - US');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(180000);
      expect(first.salaryMax).toBe(240000);
      expect(first.salaryCurrency).toBe('USD');
      expect(first.postedAt).toBeDefined();
      expect(first.description).not.toContain('<p>');
      expect(first.description).not.toContain('<strong>');
      expect(first.description.length).toBeGreaterThan(0);
      expect(first.rawSourceData).toBeDefined();
    });
    it('detects hybrid remote-mode for second job', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await greenhouse.fetch(makeConfig(['acmecorp']));
      const second = jobs[1];
      if (!second) throw new Error('expected job 1');
      expect(second.remote).toBe('hybrid');
      expect(second.location).toBe('Irvine, CA');
      expect(second.salaryMin).toBeUndefined();
    });

    it('iterates over multiple tokens and aggregates', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await greenhouse.fetch(makeConfig(['acmecorp', 'stripe']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(4);
    });

    it('builds correct URL per token', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await greenhouse.fetch(makeConfig(['acmecorp']));
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      expect(String(call[0])).toBe('https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs?content=true');
    });
    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('rate limited', { status: 429 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(greenhouse.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=network on 404 (board not found)', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('not found', { status: 404 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(greenhouse.fetch(makeConfig(['ghost']))).rejects.toMatchObject({ type: 'network' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('not json', { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(greenhouse.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when greenhouse config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(greenhouse.fetch(cfg)).rejects.toThrow();
    });

    it('skips malformed job entries', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ jobs: [{ id: 1, title: 'ok', absolute_url: 'http://x', content: 'c', location: { name: 'L' } }, null, { title: 'nope' }] }), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await greenhouse.fetch(makeConfig(['acmecorp']));
      expect(jobs).toHaveLength(1);
    });

    it('continues to next token when first token fails (partial-failure recovery)', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => Promise.resolve(new Response('boom', { status: 500 })))
        .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await greenhouse.fetch(makeConfig(['broken', 'acmecorp']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs.length).toBeGreaterThan(0);
      for (const j of jobs) expect(j.company).toBe('acmecorp');
    });

    it('throws when ALL tokens fail', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('boom', { status: 500 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(greenhouse.fetch(makeConfig(['a', 'b']))).rejects.toMatchObject({ type: 'network' });
    });
  });
});
