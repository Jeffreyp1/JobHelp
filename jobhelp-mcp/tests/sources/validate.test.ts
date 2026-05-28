import { describe, it, expect, afterEach, vi } from 'vitest';
import { validateSources } from '../../core/sources/validate.js';
import type { JobDigestConfig } from '../../core/types/config.js';

function baseConfig(): JobDigestConfig {
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
    sources: {},
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/jobhelp' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200, contentType = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('validateSources — ping coverage (current behavior)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty array when no sources enabled', async () => {
    const results = await validateSources(baseConfig());
    expect(results).toEqual([]);
  });

  it('leaves zero-source recovery guidance to the MCP validation layer', async () => {
    const results = await validateSources(baseConfig());
    expect(results).toHaveLength(0);
  });

  it('returns a ping result for greenhouse (a recognized adapter)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ jobs: [{ id: 1 }], meta: { total: 1 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { greenhouse: { tokens: ['acmecorp'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('greenhouse');
    expect(results[0]?.ok).toBe(true);
  });

  it('honors the source filter option', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ jobs: [], meta: { total: 0 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: {
        greenhouse: { tokens: ['acmecorp'] },
        lever: { slugs: ['plaid'] },
      },
    };
    const results = await validateSources(cfg, { source: 'greenhouse' });
    expect(results.every((r) => r.source === 'greenhouse')).toBe(true);
  });
});

describe('validateSources — newly-added ping coverage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pings ashby slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ jobs: [{ id: 'a' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { ashby: { tokens: ['ramp'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('ashby');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('api.ashbyhq.com/posting-api/job-board/ramp'),
    );
  });

  it('pings smartrecruiters slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ totalFound: 1, content: [{ id: 'x', name: 'Y' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { smartrecruiters: { tokens: ['visa'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('smartrecruiters');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('api.smartrecruiters.com/v1/companies/visa/postings'),
    );
  });

  it('pings workable slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'Polestar', jobs: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { workable: { tokens: ['polestar'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('workable');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('apply.workable.com/api/v1/widget/accounts/polestar'),
    );
  });

  it('pings recruitee slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ offers: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { recruitee: { tokens: ['bunq'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('recruitee');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('bunq.recruitee.com/api/offers'),
    );
  });

  it('pings teamtailor slugs (RSS feed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse('<rss><channel></channel></rss>', 200, 'application/rss+xml'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { teamtailor: { tokens: ['klarna'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('teamtailor');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('klarna.teamtailor.com/jobs.rss'),
    );
  });

  it('pings breezy slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { breezy: { tokens: ['acmehr'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('breezy');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('acmehr.breezy.hr/json'),
    );
  });

  it('pings pinpoint slugs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { pinpoint: { tokens: ['workwithus'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('pinpoint');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('workwithus.pinpointhq.com/postings.json'),
    );
  });

  it('pings personio slugs (XML feed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse('<workzag-jobs></workzag-jobs>', 200, 'application/xml'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg: JobDigestConfig = {
      ...baseConfig(),
      sources: { personio: { tokens: ['traderepublic'] } },
    };
    const results = await validateSources(cfg);
    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('personio');
    expect(results[0]?.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('traderepublic.jobs.personio.de/xml'),
    );
  });
});
