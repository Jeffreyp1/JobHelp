import { describe, it, expect, afterEach, vi } from 'vitest';

import { weworkremotely } from '../../core/sources/weworkremotely.js';
import type { JobDigestConfig } from '../../core/types/config.js';

function makeConfig(categories?: readonly string[]): JobDigestConfig {
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
    sources: { weworkremotely: categories !== undefined ? { categories } : {} },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function rssItem(opts: {
  title: string;
  link: string;
  region?: string;
  description?: string;
  guid?: string;
  pubDate?: string;
}): string {
  const region = opts.region === undefined ? '' : `<region>${opts.region}</region>`;
  const guid = opts.guid === undefined ? '' : `<guid>${opts.guid}</guid>`;
  const pub = opts.pubDate === undefined ? '' : `<pubDate>${opts.pubDate}</pubDate>`;
  const desc = opts.description ?? 'A great remote job';
  return `<item><title>${opts.title}</title><link>${opts.link}</link>${region}${guid}${pub}<description><![CDATA[${desc}]]></description></item>`;
}

function rssFeed(items: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>WWR</title>${items.join('')}</channel></rss>`;
}

function rssResponse(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { 'content-type': 'application/rss+xml' } });
}

const HAPPY_FEED = rssFeed([
  rssItem({
    title: 'Nomad: Senior Software Engineer',
    link: 'https://weworkremotely.com/remote-jobs/nomad-senior-software-engineer',
    region: 'Anywhere in the World',
    description: '<p>Build <strong>great</strong> things.</p>',
    pubDate: 'Mon, 19 May 2026 12:00:00 +0000',
  }),
  rssItem({
    title: 'Acme: Backend Engineer',
    link: 'https://weworkremotely.com/remote-jobs/acme-backend-engineer',
    region: '',
    description: 'No region here',
  }),
]);

describe('weworkremotely adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="weworkremotely"', () => {
    expect(weworkremotely.name).toBe('weworkremotely');
  });

  describe('enabled()', () => {
    it('returns true when weworkremotely config block is present', () => {
      expect(weworkremotely.enabled(makeConfig())).toBe(true);
    });

    it('returns false when weworkremotely config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(weworkremotely.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] from the main feed', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse(HAPPY_FEED));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await weworkremotely.fetch(makeConfig());

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('weworkremotely:nomad-senior-software-engineer');
      expect(first.source).toBe('weworkremotely');
      expect(first.url).toBe('https://weworkremotely.com/remote-jobs/nomad-senior-software-engineer');
      expect(first.title).toBe('Senior Software Engineer');
      expect(first.company).toBe('Nomad');
      expect(first.location).toBe('Anywhere in the World');
      expect(first.remote).toBe('remote');
      expect(first.description).not.toContain('<p>');
      expect(first.description).not.toContain('<strong>');
      expect(first.postedAt).toBeDefined();
      expect(first.rawSourceData).toBeDefined();
    });

    it('falls back to location="Remote" when the region tag is empty/absent', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse(HAPPY_FEED));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await weworkremotely.fetch(makeConfig());
      const second = jobs[1];
      if (!second) throw new Error('expected job 1');
      expect(second.location).toBe('Remote');
      expect(second.company).toBe('Acme');
    });

    it('hits the main feed URL when no categories are configured', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse(HAPPY_FEED));
      vi.stubGlobal('fetch', fetchMock);
      await weworkremotely.fetch(makeConfig());
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      expect(String(call[0])).toBe('https://weworkremotely.com/remote-jobs.rss');
    });

    it('fetches one URL per configured category', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse(HAPPY_FEED));
      vi.stubGlobal('fetch', fetchMock);
      await weworkremotely.fetch(makeConfig(['remote-back-end-programming-jobs', 'remote-front-end-programming-jobs']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse('rate limited', 429));
      vi.stubGlobal('fetch', fetchMock);
      await expect(weworkremotely.fetch(makeConfig())).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=parse on non-RSS body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('{"not":"rss"}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(weworkremotely.fetch(makeConfig())).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when weworkremotely config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(weworkremotely.fetch(cfg)).rejects.toThrow();
    });

    it('continues to next feed when first feed fails (fault isolation)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(rssResponse('boom', 500))
        .mockResolvedValueOnce(rssResponse(HAPPY_FEED));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await weworkremotely.fetch(makeConfig(['broken-cat', 'good-cat']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('throws when ALL feeds fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rssResponse('boom', 500));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        weworkremotely.fetch(makeConfig(['a', 'b'])),
      ).rejects.toMatchObject({ type: 'server' });
    });
  });
});
