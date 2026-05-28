import { describe, it, expect, afterEach, vi } from 'vitest';

import { jsearch } from '../../core/sources/jsearch.js';
import type { JobDigestConfig } from '../../core/types/config.js';

function makeConfig(queries?: readonly string[]): JobDigestConfig {
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
      jsearch: {
        rapidApiKey: 'test-key',
        ...(queries !== undefined ? { queries } : {}),
      },
    },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function job(id: string, title: string): unknown {
  return {
    job_id: id,
    job_title: title,
    employer_name: 'Acme Corp',
    job_apply_link: `https://jobs.example.com/${id}`,
    job_description: 'A solid engineering role.',
    job_city: 'Austin',
    job_country: 'US',
    job_is_remote: true,
    job_posted_at_timestamp: 1747600000,
    job_min_salary: 120000,
    job_max_salary: 160000,
    job_salary_currency: 'USD',
  };
}

function okResponse(data: readonly unknown[]): Response {
  return new Response(JSON.stringify({ status: 'OK', data }), { status: 200 });
}

describe('jsearch adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="jsearch"', () => {
    expect(jsearch.name).toBe('jsearch');
  });

  describe('enabled()', () => {
    it('returns true when rapidApiKey is set', () => {
      expect(jsearch.enabled(makeConfig())).toBe(true);
    });

    it('returns false when jsearch config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(jsearch.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single query', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse([job('a1', 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await jsearch.fetch(makeConfig(['software engineer']));

      expect(jobs).toHaveLength(1);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('jsearch:a1');
      expect(first.source).toBe('jsearch');
      expect(first.url).toBe('https://jobs.example.com/a1');
      expect(first.title).toBe('Software Engineer');
      expect(first.company).toBe('Acme Corp');
      expect(first.location).toBe('Austin, US');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(120000);
      expect(first.salaryMax).toBe(160000);
      expect(first.salaryCurrency).toBe('USD');
      expect(first.postedAt).toBeDefined();
      expect(first.rawSourceData).toBeDefined();
    });

    it('requests num_pages=20 in a single call (M4)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse([job('a1', 'Eng')]));
      vi.stubGlobal('fetch', fetchMock);
      await jsearch.fetch(makeConfig(['software engineer']));
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = new URL(String(call[0]));
      expect(url.searchParams.get('num_pages')).toBe('20');
      expect(url.searchParams.get('page')).toBe('1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(jsearch.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(jsearch.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when jsearch config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(jsearch.fetch(cfg)).rejects.toThrow();
    });

    it('continues to next query when first query fails (fault isolation)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(okResponse([job('b2', 'Backend Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await jsearch.fetch(makeConfig(['broken', 'backend engineer']));
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.some((j) => j.id === 'jsearch:b2')).toBe(true);
    });

    it('throws when ALL queries fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        jsearch.fetch(makeConfig(['a', 'b'])),
      ).rejects.toMatchObject({ type: 'server' });
    });
  });
});
