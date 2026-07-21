import { describe, it, expect, afterEach, vi } from 'vitest';

import { yc } from '../../core/sources/yc.js';
import { isGhostJob } from '../../core/pipeline/classify.js';
import type { JobDigestConfig } from '../../core/types/config.js';

function makeConfig(queries?: readonly string[]): JobDigestConfig {
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
    sources: { yc: queries !== undefined ? { queries } : {} },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function ycJob(id: number, title: string): unknown {
  return {
    id,
    title,
    companyName: 'Startup Inc',
    location: 'San Francisco, CA',
    jobType: 'fulltime',
    roleType: 'eng',
    companyOneLiner: 'We build the future.',
    salary: '$150K - $220K',
  };
}

function jobsResponse(jobs: readonly unknown[]): Response {
  return new Response(JSON.stringify({ jobs }), { status: 200 });
}

describe('yc adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="yc"', () => {
    expect(yc.name).toBe('yc');
  });

  describe('enabled()', () => {
    it('returns true when yc config block is present', () => {
      expect(yc.enabled(makeConfig())).toBe(true);
    });

    it('returns false when yc config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(yc.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single query', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jobsResponse([ycJob(42, 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await yc.fetch(makeConfig(['software engineer']));

      expect(jobs).toHaveLength(1);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('yc:42');
      expect(first.source).toBe('yc');
      expect(first.url).toBe('https://www.workatastartup.com/jobs/42');
      expect(first.title).toBe('Software Engineer');
      expect(first.company).toBe('Startup Inc');
      expect(first.location).toBe('San Francisco, CA');
      expect(first.salaryMin).toBe(150000);
      expect(first.salaryMax).toBe(220000);
      expect(first.salaryCurrency).toBe('USD');
    });

    it('drops every job when accept returns false', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jobsResponse([ycJob(42, 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await yc.fetch(makeConfig(['software engineer']), { accept: () => false });
      expect(jobs).toEqual([]);
    });

    it('keeps jobs when accept returns true', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jobsResponse([ycJob(42, 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await yc.fetch(makeConfig(['software engineer']), { accept: () => true });
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('deduplicates jobs that appear under multiple queries', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jobsResponse([ycJob(42, 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await yc.fetch(makeConfig(['software engineer', 'backend engineer']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(1);
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(yc.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(yc.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when yc config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(yc.fetch(cfg)).rejects.toThrow();
    });

    it('continues to next query when first query fails (fault isolation)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(jobsResponse([ycJob(99, 'Backend Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await yc.fetch(makeConfig(['broken', 'backend engineer']));
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.some((j) => j.id === 'yc:99')).toBe(true);
    });

    // The WaaS feed only carries roleType/jobType/one-liner, so every normalized
    // description is <200 chars; this pins the emitted source string to the
    // ghost-filter short-feed exemption so a rename on either side fails here.
    it('normalized jobs survive isGhostJob despite the short WaaS description', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jobsResponse([ycJob(42, 'Software Engineer')]));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await yc.fetch(makeConfig(['software engineer']));
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.description.length).toBeLessThan(200);
      expect(isGhostJob(first)).toBe(false);
    });

    it('throws when ALL queries fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        yc.fetch(makeConfig(['a', 'b'])),
      ).rejects.toMatchObject({ type: 'server' });
    });
  });
});
