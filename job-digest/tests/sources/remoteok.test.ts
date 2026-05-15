import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { remoteok } from '../../core/sources/remoteok.js';
import { SourceFetchError } from '../../core/sources/remoteok.js';
import type { JobDigestConfig } from '../../core/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sources', 'remoteok-response.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function makeConfig(remoteok?: JobDigestConfig['sources']['remoteok']): JobDigestConfig {
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
    sources: remoteok !== undefined ? { remoteok } : {},
    ranking: { useLlmFitScore: false, topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

describe('remoteok adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="remoteok"', () => {
    expect(remoteok.name).toBe('remoteok');
  });

  describe('enabled()', () => {
    it('returns true when remoteok config block exists', () => {
      expect(remoteok.enabled(makeConfig({}))).toBe(true);
    });

    it('returns true when remoteok config has tags', () => {
      expect(remoteok.enabled(makeConfig({ tags: ['python', 'backend'] }))).toBe(true);
    });

    it('returns false when remoteok config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(remoteok.enabled(cfg)).toBe(false);
    });

    it('returns false when sources has no remoteok key', () => {
      expect(remoteok.enabled(makeConfig(undefined))).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns empty array when remoteok config is missing', async () => {
      const jobs = await remoteok.fetch(makeConfig(undefined));
      expect(jobs).toHaveLength(0);
    });

    it('returns NormalizedJob[] with correct shape', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remoteok.fetch(makeConfig({}));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected first job');
      expect(first.id).toBe('remoteok:rust-backend-engineer-107411');
      expect(first.source).toBe('remoteok');
      expect(first.url).toBe('https://examplecorp.com/jobs/rust-backend');
      expect(first.title).toBe('Rust Backend Engineer');
      expect(first.company).toBe('ExampleCorp');
      expect(first.remote).toBe('remote');
      expect(first.salaryMin).toBe(140000);
      expect(first.salaryMax).toBe(190000);
      expect(first.postedAt).toBeDefined();
      expect(first.description.length).toBeGreaterThan(0);
      expect(first.rawSourceData).toBeDefined();
    });

    it('maps all jobs as remote=remote', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remoteok.fetch(makeConfig({}));
      for (const job of jobs) {
        expect(job.remote).toBe('remote');
      }
    });

    it('second job falls back to url when apply_url is empty', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remoteok.fetch(makeConfig({}));
      const second = jobs[1];
      if (!second) throw new Error('expected second job');
      expect(second.id).toBe('remoteok:frontend-react-developer-107412');
      expect(second.url).toBe('https://remoteok.com/remote-jobs/frontend-react-developer-107412');
      expect(second.salaryMin).toBeUndefined();
      expect(second.salaryMax).toBeUndefined();
    });

    it('skips the first meta element (legal notice)', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remoteok.fetch(makeConfig({}));
      for (const job of jobs) {
        expect(job.company).not.toContain('legal');
        expect(job.id).not.toContain('legal');
      }
    });

    it('fetches general feed when tags is empty', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remoteok.fetch(makeConfig({ tags: [] }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('remoteok.com/api');
      expect(url).not.toContain('tags=');
    });

    it('includes tags param when tags are provided', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remoteok.fetch(makeConfig({ tags: ['python', 'backend'] }));

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const url = String(call[0]);
      expect(url).toContain('tags=python%2Cbackend');
    });

    it('sends User-Agent header per RemoteOK TOS', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await remoteok.fetch(makeConfig({}));

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error('expected fetch call');
      const opts = call[1] as RequestInit | undefined;
      const headers = opts?.headers as Record<string, string> | undefined;
      expect(headers?.['User-Agent']).toBeDefined();
      expect(headers?.['User-Agent']).toContain('JobHelp');
    });

    it('converts epoch to ISO postedAt', async () => {
      const fixture = loadFixture();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fixture), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await remoteok.fetch(makeConfig({}));
      const first = jobs[0];
      if (!first) throw new Error('expected first job');
      expect(first.postedAt).toBe(new Date(1746921600 * 1000).toISOString());
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remoteok.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=network on 500', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remoteok.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'network' });
    });

    it('throws SourceFetchError with type=parse on malformed JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remoteok.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws SourceFetchError with type=parse when response is not an array', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'oops' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(remoteok.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'parse' });
    });

    it('skips malformed job entries', async () => {
      const body = [
        { legal: 'meta' },
        { id: 'good-job-123', url: 'http://x', company: 'C', position: 'T', description: 'D', location: '' },
        null,
        { position: 'missing required fields' },
        'string-entry',
      ];
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const jobs = await remoteok.fetch(makeConfig({}));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe('remoteok:good-job-123');
    });

    it('throws when fetch rejects (network error)', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', fetchMock);
      await expect(remoteok.fetch(makeConfig({}))).rejects.toMatchObject({ type: 'network' });
    });

    it('SourceFetchError is exported from remoteok module', () => {
      expect(SourceFetchError).toBeDefined();
      const err = new SourceFetchError('network', 'test');
      expect(err.type).toBe('network');
      expect(err.name).toBe('SourceFetchError');
    });
  });
});
