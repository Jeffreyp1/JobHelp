import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { adzuna } from '../../core/sources/adzuna.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'adzuna-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}
type AdzunaCfg = NonNullable<JobDigestConfig['sources']['adzuna']>;

function makeConfig(overrides?: Partial<AdzunaCfg>): JobDigestConfig {
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
    sources: {
      adzuna: {
        appId: 'test-id',
        appKey: 'test-key',
        country: 'us',
        queries: ['software engineer'],
        ...overrides,
      },
    },
    ranking: {
      useLlmFitScore: false,
      llmModel: 'claude-haiku-4-5',
      topN: 20,
      digestK: 10,
    },
    output: { dir: '/tmp/jobhelp' },
    anthropic: { apiKey: 'test-anthropic-key' },
  };
}
describe('adzuna adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('enabled()', () => {
    it('returns true when appId and appKey are present', () => {
      expect(adzuna.enabled(makeConfig())).toBe(true);
    });

    it('returns false when adzuna config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(adzuna.enabled(cfg)).toBe(false);
    });

    it('returns false when appId is empty', () => {
      const cfg = makeConfig({ appId: '' });
      expect(adzuna.enabled(cfg)).toBe(false);
    });

    it('returns false when appKey is empty', () => {
      const cfg = makeConfig({ appKey: '' });
      expect(adzuna.enabled(cfg)).toBe(false);
    });
  });

  it('has name="adzuna"', () => {
    expect(adzuna.name).toBe('adzuna');
  });
  describe('fetch()', () => {
    it('returns NormalizedJob[] with correct shape', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await adzuna.fetch(makeConfig());

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected first job');
      expect(first.id).toBe('adzuna:4567890123');
      expect(first.source).toBe('adzuna');
      expect(first.url).toBe('https://www.adzuna.com/land/ad/4567890123');
      expect(first.title).toBe('Software Engineer I (Remote)');
      expect(first.company).toBe('Acme Cloud');
      expect(first.location).toBe('Remote, US');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(120000);
      expect(first.salaryMax).toBe(160000);
      expect(first.salaryCurrency).toBe('USD');
      expect(first.postedAt).toBe('2026-05-12T14:32:00.000Z');
      expect(first.description.length).toBeGreaterThan(0);
      expect(first.rawSourceData).toBeDefined();
    });
    it('detects hybrid remote-mode from description', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await adzuna.fetch(makeConfig());
      const second = jobs[1];
      if (!second) throw new Error('expected second job');
      expect(second.remote).toBe('hybrid');
      expect(second.location).toBe('Irvine, CA');
    });

    it('iterates queries and aggregates results', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const cfg = makeConfig({ queries: ['software engineer', 'backend engineer'] });
      const jobs = await adzuna.fetch(cfg);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(4);
    });
    it('builds correct URL with app_id, app_key, country, and query', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await adzuna.fetch(makeConfig());

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('api.adzuna.com/v1/api/jobs/us/search/1');
      expect(url).toContain('app_id=test-id');
      expect(url).toContain('app_key=test-key');
      expect(url).toContain('what=software+engineer');
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('rate limited', { status: 429 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(adzuna.fetch(makeConfig())).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=auth on 401', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('unauthorized', { status: 401 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(adzuna.fetch(makeConfig())).rejects.toMatchObject({ type: 'auth' });
    });
    it('throws SourceFetchError with type=network on 500', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('boom', { status: 500 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(adzuna.fetch(makeConfig())).rejects.toMatchObject({ type: 'network' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('not json', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(adzuna.fetch(makeConfig())).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when results is not an array', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: 'oops' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(adzuna.fetch(makeConfig())).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when adzuna config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(adzuna.fetch(cfg)).rejects.toThrow();
    });
    it('skips malformed result entries instead of throwing', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { id: 'good', title: 'T', description: 'D', redirect_url: 'http://x', company: { display_name: 'C' }, location: { display_name: 'L' } },
              null,
              { title: 'bad' },
              'string-entry',
            ],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await adzuna.fetch(makeConfig());
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      if (!job) throw new Error('expected one job');
      expect(job.id).toBe('adzuna:good');
    });
  });
});
