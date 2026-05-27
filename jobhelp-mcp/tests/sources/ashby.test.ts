import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ashby } from '../../core/sources/ashby.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'ashby-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function isFixtureWithJobs(v: unknown): v is { jobs: Array<Record<string, unknown>> } {
  return typeof v === 'object' && v !== null && Array.isArray((v as { jobs?: unknown }).jobs);
}

function makeConfig(tokens: readonly string[] = ['acmecorp']): JobDigestConfig {
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
    sources: { ashby: { tokens } },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

describe('ashby adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="ashby"', () => {
    expect(ashby.name).toBe('ashby');
  });

  describe('enabled()', () => {
    it('returns true when at least one token is configured', () => {
      expect(ashby.enabled(makeConfig(['acmecorp']))).toBe(true);
    });

    it('returns false when tokens array is empty', () => {
      expect(ashby.enabled(makeConfig([]))).toBe(false);
    });

    it('returns false when ashby config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(ashby.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single token from fixture', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await ashby.fetch(makeConfig(['acmecorp']));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('ashby:11111111-aaaa-bbbb-cccc-222222222222');
      expect(first.source).toBe('ashby');
      expect(first.url).toBe('https://jobs.ashbyhq.com/acmecorp/11111111-aaaa-bbbb-cccc-222222222222');
      expect(first.title).toBe('Senior Distributed Systems Engineer');
      expect(first.company).toBe('acmecorp');
      expect(first.location).toBe('Remote - US');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(180000);
      expect(first.salaryMax).toBe(240000);
      expect(first.salaryCurrency).toBe('USD');
      expect(first.postedAt).toBeDefined();
      expect(first.description).toContain('Build distributed systems');
      expect(first.description).not.toContain('<p>');
      expect(first.rawSourceData).toBeDefined();
    });

    it('maps workplaceType Hybrid → remote=hybrid and omits salary when compensation absent', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp']));
      const second = jobs[1];
      if (!second) throw new Error('expected job 1');
      expect(second.remote).toBe('hybrid');
      expect(second.location).toBe('Austin, TX');
      expect(second.salaryMin).toBeUndefined();
      expect(second.salaryMax).toBeUndefined();
      expect(second.salaryCurrency).toBeUndefined();
    });

    it('maps workplaceType InPerson → remote=onsite', async () => {
      const fixture = loadFixture();
      const baseJob = isFixtureWithJobs(fixture) ? fixture.jobs[0] : undefined;
      if (!baseJob) throw new Error('fixture missing first job');
      const modified = { jobs: [{ ...baseJob, workplaceType: 'InPerson' }] };
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(modified), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp']));
      const j = jobs[0];
      if (!j) throw new Error('expected job');
      expect(j.remote).toBe('onsite');
    });

    it('falls through to text-based remote detection when workplaceType is Unspecified', async () => {
      const fixture = loadFixture();
      const baseJob = isFixtureWithJobs(fixture) ? fixture.jobs[0] : undefined;
      if (!baseJob) throw new Error('fixture missing first job');
      const modified = {
        jobs: [{
          ...baseJob,
          workplaceType: 'Unspecified',
          location: 'Anywhere',
          descriptionPlain: 'This is a fully remote role anywhere in the US.',
        }],
      };
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(modified), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp']));
      const j = jobs[0];
      if (!j) throw new Error('expected job');
      expect(j.remote).toBe('remote');
    });

    it('returns empty array when board has zero postings', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ jobs: [], apiVersion: '1' }), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp']));
      expect(jobs).toHaveLength(0);
    });

    it('iterates over multiple tokens and aggregates', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp', 'stripe']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(4);
    });

    it('builds correct URL with includeCompensation=true per token', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await ashby.fetch(makeConfig(['acmecorp']));
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      expect(String(call[0])).toBe('https://api.ashbyhq.com/posting-api/job-board/acmecorp?includeCompensation=true');
    });

    it('URL-encodes the token', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(fixture), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await ashby.fetch(makeConfig(['a b/c']));
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      expect(String(call[0])).toBe('https://api.ashbyhq.com/posting-api/job-board/a%20b%2Fc?includeCompensation=true');
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('rate limited', { status: 429 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=not_found on 404 (plaintext body)', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('Not Found', { status: 404 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['ghost']))).rejects.toMatchObject({ type: 'not_found' });
    });

    it('throws SourceFetchError with type=auth on 401', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('unauthorized', { status: 401 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'auth' });
    });

    it('throws SourceFetchError with type=client on 400', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('bad request', { status: 400 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'client' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('not json', { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when body.jobs is not an array', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ jobs: 'oops' }), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=auth when ashby config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(ashby.fetch(cfg)).rejects.toMatchObject({ type: 'auth' });
    });

    it('skips malformed job entries (missing required fields)', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({
          jobs: [
            {
              id: 'ok-uuid',
              title: 'Valid',
              jobUrl: 'https://jobs.ashbyhq.com/x/ok-uuid',
              location: 'L',
              workplaceType: 'Remote',
              descriptionPlain: 'desc',
            },
            null,
            { title: 'missing id and url' },
            { id: 'no-title', jobUrl: 'http://x' },
          ],
        }), { status: 200 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['acmecorp']));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe('ashby:ok-uuid');
    });

    it('continues to next token when first token fails (partial-failure recovery)', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => Promise.resolve(new Response('boom', { status: 500 })))
        .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })));
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await ashby.fetch(makeConfig(['broken', 'acmecorp']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(jobs.length).toBeGreaterThan(0);
      for (const j of jobs) expect(j.company).toBe('acmecorp');
    });

    it('throws when ALL tokens fail', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
        new Response('boom', { status: 500 }),
      ));
      vi.stubGlobal('fetch', fetchMock);
      await expect(ashby.fetch(makeConfig(['a', 'b']))).rejects.toMatchObject({ type: 'server' });
    });
  });
});
