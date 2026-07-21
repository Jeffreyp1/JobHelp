import { describe, it, expect, afterEach, vi } from 'vitest';

import { personio } from '../../core/sources/personio.js';
import { SourceFetchError } from '../../core/sources/personio.js';
import type { JobDigestConfig } from '../../core/types/config.js';

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
    sources: { personio: { tokens } },
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<workzag-jobs>
  <position>
    <id>1001</id>
    <name>Senior Backend Engineer</name>
    <office>Remote - US</office>
    <department>Engineering</department>
    <createdAt>2025-05-01T00:00:00Z</createdAt>
    <jobDescriptions>
      <jobDescription>
        <name>Role</name>
        <value><![CDATA[<p>Build distributed systems.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
  </position>
  <position>
    <id>1002</id>
    <name>Frontend Engineer</name>
    <office>Austin, TX</office>
    <department>Engineering</department>
    <createdAt>2025-05-02T00:00:00Z</createdAt>
    <jobDescriptions>
      <jobDescription>
        <name>Role</name>
        <value><![CDATA[<p>Build UIs.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
  </position>
</workzag-jobs>`;

function feedResponse(): Response {
  return new Response(FEED, { status: 200 });
}

describe('personio adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has name="personio"', () => {
    expect(personio.name).toBe('personio');
  });

  describe('enabled()', () => {
    it('returns true when at least one token is configured', () => {
      expect(personio.enabled(makeConfig(['acmecorp']))).toBe(true);
    });

    it('returns false when tokens array is empty', () => {
      expect(personio.enabled(makeConfig([]))).toBe(false);
    });

    it('returns false when personio config is missing', () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      expect(personio.enabled(cfg)).toBe(false);
    });
  });

  describe('fetch()', () => {
    it('returns NormalizedJob[] for a single token', async () => {
      const fetchMock = vi.fn().mockResolvedValue(feedResponse());
      vi.stubGlobal('fetch', fetchMock);

      const jobs = await personio.fetch(makeConfig(['acmecorp']));

      expect(jobs).toHaveLength(2);
      const first = jobs[0];
      if (!first) throw new Error('expected job');
      expect(first.id).toBe('personio:1001');
      expect(first.source).toBe('personio');
      expect(first.url).toBe('https://acmecorp.jobs.personio.de/job/1001');
      expect(first.title).toBe('Senior Backend Engineer');
      expect(first.company).toBe('acmecorp');
      expect(first.location).toBe('Remote - US');
      expect(first.remote).toBe('remote');
      expect(first.postedAt).toBeDefined();
      expect(first.description).not.toContain('<p>');
      expect(first.description.length).toBeGreaterThan(0);
    });

    it('applies accept predicate to filter normalized jobs', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(feedResponse()));
      vi.stubGlobal('fetch', fetchMock);

      const rejected = await personio.fetch(makeConfig(['acmecorp']), { accept: () => false });
      expect(rejected).toEqual([]);

      const accepted = await personio.fetch(makeConfig(['acmecorp']), {
        accept: (job) => job.title.includes('Backend'),
      });
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.title).toBe('Senior Backend Engineer');
    });

    it('throws SourceFetchError with type=rate_limit on 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(personio.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'rate_limit' });
    });

    it('throws SourceFetchError with type=parse when feed lacks position tags', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(personio.fetch(makeConfig(['acmecorp']))).rejects.toMatchObject({ type: 'parse' });
    });

    it('throws when personio config is missing', async () => {
      const cfg: JobDigestConfig = { ...makeConfig(), sources: {} };
      await expect(personio.fetch(cfg)).rejects.toThrow();
    });

    it('throws when ALL tokens fail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(personio.fetch(makeConfig(['a', 'b']))).rejects.toMatchObject({ type: 'server' });
    });

    it('SourceFetchError is exported from personio module', () => {
      expect(SourceFetchError).toBeDefined();
      const err = new SourceFetchError('parse', 'test');
      expect(err.type).toBe('parse');
      expect(err.name).toBe('SourceFetchError');
    });
  });
});
