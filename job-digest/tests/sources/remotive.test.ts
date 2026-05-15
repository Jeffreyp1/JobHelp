import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { remotive } from '../../core/sources/remotive.js';
import { SourceFetchError } from '../../core/sources/remotive.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'remotive-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function makeConfig(remotive?: JobDigestConfig['sources']['remotive']): JobDigestConfig {
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
    sources: remotive !== undefined ? { remotive } : {},
    ranking: { useLlmFitScore: false, topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

describe('remotive adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="remotive"', () => {
    expect(remotive.name).toBe('remotive');
  });

  describe('enabled()', () => {
    it('returns true when remotive config block exists', () => {
      expect(remotive.enabled(makeConfig({}))).toBe(true);
    });

    it('returns true when remotive config has queries', () => {
      expect(remotive.enabled(makeConfig({ queries: ['engineer'] }))).toBe(true);
    });

    it('returns false when remotive config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(remotive.enabled(cfg)).toBe(false);
    });

    it('returns false when sources is empty object', () => {
      expect(remotive.enabled(makeConfig(undefined))).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns empty array when remotive config is missing', async () => {
      const jobs = await remotive.fetch(makeConfig(undefined));
      expect(jobs).toHaveLength(0);
    });

    it('returns NormalizedJob[] with correct shape', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remotive.fetch(makeConfig({}));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected first job');
      expect(first.id).toBe('remotive:3001');
      expect(first.source).toBe('remotive');
      expect(first.url).toBe('https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-3001');
      expect(first.title).toBe('Senior Backend Engineer');
      expect(first.company).toBe('Acme Remote Inc');
      expect(first.location).toBe('Worldwide');
      expect(first.remote).toBe('remote');
      expect(first.description.length).toBeGreaterThan(0);
      expect(first.rawSourceData).toBeDefined();
      expect(first.postedAt).toBeDefined();
    });

    it('maps all jobs as remote=remote', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remotive.fetch(makeConfig({}));
      for (const job of jobs) {
        expect(job.remote).toBe('remote');
      }
    });

    it('second job has correct shape', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remotive.fetch(makeConfig({}));
      const second = jobs[1];
      if (!second) throw new Error('expected second job');
      expect(second.id).toBe('remotive:3002');
      expect(second.company).toBe('Beta Design Co');
      expect(second.location).toBe('US Only');
    });

    it('fetches general feed when queries is empty', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remotive.fetch(makeConfig({ queries: [] }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('remotive.com/api/remote-jobs');
      expect(url).not.toContain('search=');
    });

    it('includes search param when query is provided', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remotive.fetch(makeConfig({ queries: ['python engineer'] }));

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('search=python+engineer');
    });

    it('includes limit param in URL', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remotive.fetch(makeConfig({ limit: 50 }));

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('limit=50');
    });

    it('uses default limit=100 when not specified', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remotive.fetch(makeConfig({}));

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('limit=100');
    });

    it('iterates multiple queries and aggregates results', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remotive.fetch(makeConfig({ queries: ['python', 'backend'] }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(4);
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remotive.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=network on 500', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remotive.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'network' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remotive.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when response is not an object', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(remotive.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when jobs field is not an array', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ jobs: 'oops' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(remotive.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('skips malformed job entries', async () => {
      const body = {
        jobs: [
          { id: 9001, url: 'http://x', title: 'T', company_name: 'C', description: 'D', candidate_required_location: 'Worldwide' },
          null,
          { title: 'missing required fields' },
          'string-entry',
        ],
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await remotive.fetch(makeConfig({}));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe('remotive:9001');
    });

    it('continues to next query when first fails (partial-failure recovery)', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => Promise.resolve(new Response('boom', { status: 500 })))
        .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remotive.fetch(makeConfig({ queries: ['fails', 'succeeds'] }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('throws when all queries fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        remotive.fetch(makeConfig({ queries: ['a', 'b'] })),
      ).rejects.toMatchObject({ type: 'network' });
    });

    it('SourceFetchError is exported from remotive module', () => {
      expect(SourceFetchError).toBeDefined();
      const err = new SourceFetchError('parse', 'test');
      expect(err.type).toBe('parse');
      expect(err.name).toBe('SourceFetchError');
    });
  });
});
