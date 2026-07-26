import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hn, SourceFetchError } from '../../core/sources/hn.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, '..', 'fixtures', 'sources');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

function storyFixture(): unknown {
  return loadFixture('hn-story-search.json');
}

function itemFixture(): unknown {
  return loadFixture('hn-item.json');
}

function makeConfig(hnCfg?: JobDigestConfig['sources']['hn']): JobDigestConfig {
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
    sources: hnCfg !== undefined ? { hn: hnCfg } : {},
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function stubFetch(storyBody: unknown, itemBody: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('/search_by_date')) {
      return Promise.resolve(new Response(JSON.stringify(storyBody), { status: 200 }));
    }
    if (url.includes('/items/')) {
      return Promise.resolve(new Response(JSON.stringify(itemBody), { status: 200 }));
    }
    return Promise.resolve(new Response('unexpected url', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('hn adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has name="hn"', () => {
    expect(hn.name).toBe('hn');
  });

  describe('enabled()', () => {
    it('returns true when hn config block exists', () => {
      expect(hn.enabled(makeConfig({}))).toBe(true);
    });

    it('returns true when hn config has queries', () => {
      expect(hn.enabled(makeConfig({ queries: ['engineer'] }))).toBe(true);
    });

    it('returns false when hn config is missing', () => {
      expect(hn.enabled(makeConfig(undefined))).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns empty array when hn config is missing', async () => {
      const jobs = await hn.fetch(makeConfig(undefined));
      expect(jobs).toHaveLength(0);
    });

    it('queries Algolia for whoishiring stories, then the matched story item', async () => {
      const fetchMock = stubFetch(storyFixture(), itemFixture());
      await hn.fetch(makeConfig({}));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
      const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
      expect(firstUrl).toContain('hn.algolia.com/api/v1/search_by_date');
      expect(firstUrl).toContain('author_whoishiring');
      expect(secondUrl).toContain('hn.algolia.com/api/v1/items/45100001');
    });

    it('picks the newest story whose title matches "who is hiring", not sibling threads', async () => {
      const fetchMock = stubFetch(storyFixture(), itemFixture());
      await hn.fetch(makeConfig({}));
      const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
      expect(secondUrl).not.toContain('45100002');
      expect(secondUrl).not.toContain('44100001');
    });

    it('parses top-level pipe-format comments into NormalizedJob', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));

      const acme = jobs.find((j) => j.company === 'Acme Robotics');
      if (!acme) throw new Error('expected Acme Robotics job');
      expect(acme.id).toBe('hn:41000101');
      expect(acme.source).toBe('hn');
      expect(acme.url).toBe('https://news.ycombinator.com/item?id=41000101');
      expect(acme.title).toBe('Senior Backend Engineer');
      expect(acme.location).toBe('San Francisco, CA');
      expect(acme.remote).toBe('remote');
      expect(acme.salaryMin).toBe(150000);
      expect(acme.salaryMax).toBe(200000);
      expect(acme.salaryCurrency).toBe('USD');
      expect(acme.postedAt).toBe('2026-07-01T16:12:03.000Z');
    });

    it('strips HTML and decodes entities in the description', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));
      const acme = jobs.find((j) => j.company === 'Acme Robotics');
      if (!acme) throw new Error('expected Acme Robotics job');
      expect(acme.description).toContain("We're building autonomous warehouse robots");
      expect(acme.description).toContain('https://acme.example/jobs');
      expect(acme.description).not.toContain('<p>');
      expect(acme.description).not.toContain('&#x27;');
    });

    it('finds the role segment even when segments are out of order', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));
      const globex = jobs.find((j) => j.company === 'Globex');
      if (!globex) throw new Error('expected Globex job');
      expect(globex.title).toBe('Full-Stack Developer');
      expect(globex.location).toBe('New York');
      expect(globex.remote).toBe('onsite');
      expect(globex.salaryMin).toBe(120000);
      expect(globex.salaryMax).toBeUndefined();
    });

    it('parses euro salary ranges from decimal entities', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));
      const initech = jobs.find((j) => j.company === 'Initech GmbH');
      if (!initech) throw new Error('expected Initech job');
      expect(initech.title).toBe('DevOps Engineer');
      expect(initech.remote).toBe('remote');
      expect(initech.salaryMin).toBe(70000);
      expect(initech.salaryMax).toBe(90000);
      expect(initech.salaryCurrency).toBe('EUR');
    });

    it('keeps long prose posts without pipes', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));
      const foo = jobs.find((j) => j.id === 'hn:41000106');
      if (!foo) throw new Error('expected FooCorp job');
      expect(foo.company).toBe('FooCorp is hiring senior engineers in Austin, TX.');
      expect(foo.description).toContain('distributed-systems work in Rust');
    });

    it('skips replies, short junk comments, and deleted comments', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({}));
      expect(jobs).toHaveLength(4);
      const ids = jobs.map((j) => j.id);
      expect(ids).not.toContain('hn:41000999');
      expect(ids).not.toContain('hn:41000103');
      expect(ids).not.toContain('hn:41000104');
    });

    it('applies the queries filter case-insensitively against title+description', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({ queries: ['DEVOPS'] }));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.company).toBe('Initech GmbH');
    });

    it('keeps everything when queries is an empty array', async () => {
      stubFetch(storyFixture(), itemFixture());
      const jobs = await hn.fetch(makeConfig({ queries: [] }));
      expect(jobs).toHaveLength(4);
    });

    it('applies the accept predicate at accumulation time', async () => {
      stubFetch(storyFixture(), itemFixture());
      const rejected = await hn.fetch(makeConfig({}), { accept: () => false });
      expect(rejected).toEqual([]);
      const accepted = await hn.fetch(makeConfig({}), {
        accept: (job) => job.company === 'Globex',
      });
      expect(accepted).toHaveLength(1);
    });

    it('throws SourceFetchError type=rate_limit on 429 from story search', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(hn.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError type=server on 500 from the item fetch', async () => {
      const fetchMock = vi.fn().mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.includes('/search_by_date')) {
          return Promise.resolve(new Response(JSON.stringify(storyFixture()), { status: 200 }));
        }
        return Promise.resolve(new Response('boom', { status: 500 }));
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(hn.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'server' });
    });

    it('throws SourceFetchError type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(hn.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError type=not_found when no story title matches', async () => {
      const body = {
        hits: [
          { created_at: '2026-07-01T15:00:03Z', title: 'Ask HN: Who wants to be hired? (July 2026)', objectID: '45100002' },
        ],
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(hn.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'not_found' });
    });

    it('throws SourceFetchError type=parse when the item has no children array', async () => {
      stubFetch(storyFixture(), { id: 45100001, children: 'nope' });
      await expect(hn.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('exports SourceFetchError', () => {
      const err = new SourceFetchError('parse', 'test');
      expect(err.type).toBe('parse');
      expect(err.name).toBe('SourceFetchError');
    });
  });
});
