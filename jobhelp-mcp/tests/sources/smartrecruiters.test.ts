import { describe, it, expect, afterEach, vi } from 'vitest';

import { smartrecruiters } from '../../core/sources/smartrecruiters.js';
import type { JobDigestConfig } from '../../core/types/config.js';

function makeConfig(tokens: readonly string[] = ['visa']): JobDigestConfig {
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
    sources: { smartrecruiters: { tokens } },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function srPostingFixture(): unknown {
  return {
    totalFound: 1,
    content: [
      {
        id: '743999000000123',
        uuid: 'uuid-1',
        name: 'Senior Backend Engineer',
        releasedDate: '2026-05-01T12:00:00.000Z',
        location: { city: 'Foster City', region: 'CA', country: 'US', remote: false },
        company: { name: 'Visa' },
      },
    ],
  };
}

describe('smartrecruiters adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has name="smartrecruiters"', () => {
    expect(smartrecruiters.name).toBe('smartrecruiters');
  });

  describe('enabled()', () => {
    it('returns true when at least one token is configured', () => {
      expect(smartrecruiters.enabled(makeConfig(['visa']))).toBe(true);
    });

    it('returns false when tokens array is empty', () => {
      expect(smartrecruiters.enabled(makeConfig([]))).toBe(false);
    });

    it('returns false when smartrecruiters config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(smartrecruiters.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single token', async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(srPostingFixture()), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await smartrecruiters.fetch(makeConfig(['visa']));

      expect(jobs).toHaveLength(1);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('smartrecruiters:743999000000123');
      expect(first.source).toBe('smartrecruiters');
      expect(first.url).toBe('https://jobs.smartrecruiters.com/visa/743999000000123');
      expect(first.title).toBe('Senior Backend Engineer');
      expect(first.company).toBe('Visa');
      expect(first.location).toBe('Foster City, CA, US');
      expect(first.postedAt).toBe('2026-05-01T12:00:00.000Z');
    });

    it('drops every job when accept returns false', async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(srPostingFixture()), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await smartrecruiters.fetch(makeConfig(['visa']), { accept: () => false });

      expect(jobs).toEqual([]);
    });

    it('keeps jobs when accept returns true', async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(srPostingFixture()), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await smartrecruiters.fetch(makeConfig(['visa']), { accept: () => true });

      expect(jobs.length).toBeGreaterThan(0);
    });

    it('throws when slug returns totalFound=0 and content=[]', async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ totalFound: 0, content: [] }), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(smartrecruiters.fetch(makeConfig(['bogus']))).rejects.toThrow(/totalFound=0/);
    });

    it('throws on non-2xx HTTP', async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response('boom', { status: 500 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(smartrecruiters.fetch(makeConfig(['visa']))).rejects.toThrow(/HTTP 500/);
    });
  });
});
