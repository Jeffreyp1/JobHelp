import { describe, it, expect, afterEach, vi } from 'vitest';

import { usajobs } from '../../core/sources/usajobs.js';
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
    sources: {
      usajobs: {
        apiKey: 'test-key',
        email: 'test@example.com',
        ...(queries !== undefined ? { queries } : {}),
      },
    },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function position(id: string, title: string): unknown {
  return {
    MatchedObjectId: id,
    MatchedObjectDescriptor: {
      PositionID: id,
      PositionTitle: title,
      PositionURI: `https://www.usajobs.gov/job/${id}`,
      OrganizationName: 'Department of Testing',
      PositionLocation: [{ LocationName: 'Washington, DC' }],
      PublicationStartDate: '2026-05-01',
      UserArea: { Details: { JobSummary: 'A federal job summary.' } },
      PositionRemuneration: [{ MinimumRange: '90000', MaximumRange: '130000' }],
    },
  };
}

function searchPage(items: readonly unknown[], countAll: number): unknown {
  return {
    SearchResult: {
      SearchResultCount: items.length,
      SearchResultCountAll: countAll,
      SearchResultItems: items,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('usajobs adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="usajobs"', () => {
    expect(usajobs.name).toBe('usajobs');
  });

  describe('enabled()', () => {
    it('returns true when apiKey and email are set', () => {
      expect(usajobs.enabled(makeConfig())).toBe(true);
    });

    it('returns false when usajobs config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(usajobs.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single query', async () => {
      const page = searchPage([position('100', 'Software Engineer')], 1);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await usajobs.fetch(makeConfig(['software engineer']));

      expect(jobs).toHaveLength(1);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('usajobs:100');
      expect(first.source).toBe('usajobs');
      expect(first.url).toBe('https://www.usajobs.gov/job/100');
      expect(first.title).toBe('Software Engineer');
      expect(first.company).toBe('Department of Testing');
      expect(first.location).toBe('Washington, DC');
      expect(first.salaryMin).toBe(90000);
      expect(first.salaryMax).toBe(130000);
      expect(first.postedAt).toBeDefined();
    });

    it('drops every job when accept returns false', async () => {
      const page = searchPage([position('100', 'Software Engineer')], 1);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await usajobs.fetch(makeConfig(['software engineer']), { accept: () => false });

      expect(jobs).toEqual([]);
    });

    it('keeps jobs when accept returns true', async () => {
      const page = searchPage([position('100', 'Software Engineer')], 1);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await usajobs.fetch(makeConfig(['software engineer']), { accept: () => true });

      expect(jobs.length).toBeGreaterThan(0);
    });

    it('collects all results across paginated responses (M2)', async () => {
      // Page 1 reports 3 total but returns only 2; page 2 returns the rest.
      const p1 = searchPage([position('1', 'Eng 1'), position('2', 'Eng 2')], 3);
      const p2 = searchPage([position('3', 'Eng 3')], 3);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(p1))
        .mockResolvedValueOnce(jsonResponse(p2));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await usajobs.fetch(makeConfig(['software engineer']));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.id).sort()).toEqual(['usajobs:1', 'usajobs:2', 'usajobs:3']);
      const secondCall = fetchMock.mock.calls[1];
      if (!secondCall) throw new Error('expected 2nd fetch call');
      expect(String(secondCall[0])).toContain('Page=2');
    });

    it('does not request a second page when page 1 already has every result', async () => {
      const p1 = searchPage([position('1', 'Eng 1'), position('2', 'Eng 2')], 2);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(p1));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await usajobs.fetch(makeConfig(['software engineer']));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jobs).toHaveLength(2);
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('rate limited', 429));
      vi.stubGlobal('fetch', fetchMock);
      await expect(usajobs.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(usajobs.fetch(makeConfig(['a']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when usajobs config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(usajobs.fetch(cfg)).rejects.toThrow();
    });

    it('continues to next query when first query fails (fault isolation)', async () => {
      const goodPage = searchPage([position('200', 'Backend Engineer')], 1);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse('boom', 500))
        .mockResolvedValueOnce(jsonResponse(goodPage));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await usajobs.fetch(makeConfig(['broken', 'backend engineer']));
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.some((j) => j.id === 'usajobs:200')).toBe(true);
    });

    it('throws when ALL queries fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('boom', 500));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        usajobs.fetch(makeConfig(['a', 'b'])),
      ).rejects.toMatchObject({ type: 'server' });
    });
  });
});
