/**
 * jobDiscovery.test.ts (Apps Script)
 *
 * Behaviour the discovery library must guarantee:
 *   - Each adapter normalises a representative source payload into DiscoveredJob.
 *   - One source returning 5xx (or malformed JSON) does not break the others.
 *   - Disabled sources (missing creds) contribute nothing.
 *   - discoveredAt is stamped on every job; `remote` is true only when the
 *     location/title mentions "remote", else null.
 *   - dedupJobs keeps the duplicate with the longer description.
 *   - stripHtml decodes the common entities and strips tags.
 *
 * UrlFetchApp is stubbed via vi.stubGlobal with a router keyed by URL substring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverJobs, dedupJobs, stripHtml } from '../../src/lib/jobDiscovery';
import type { DiscoveredJob, DiscoveryConfig } from '../../src/types/job-discovery';

// ---------------------------------------------------------------------------
// UrlFetchApp router stub
// ---------------------------------------------------------------------------

interface Route {
  match: string; // substring of the requested URL
  status?: number; // default 200
  body: string;
}

function stubFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  const fetch = vi.fn((url: string, _options?: object) => {
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    const body = route?.body ?? 'Not Found';
    return {
      getResponseCode: () => status,
      getContentText: () => body,
    };
  });
  vi.stubGlobal('UrlFetchApp', { fetch });
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Sample payloads
// ---------------------------------------------------------------------------

const ADZUNA_BODY = JSON.stringify({
  results: [
    {
      id: '12345',
      title: 'Senior Backend Engineer',
      company: { display_name: 'Acme Corp' },
      location: { display_name: 'San Francisco, CA' },
      redirect_url: 'https://www.adzuna.com/details/12345',
      description: 'Build scalable services in Go and Rust.',
      created: '2026-05-01T09:00:00Z',
      salary_min: 150000,
      salary_max: 200000,
    },
    {
      id: '67890',
      title: 'Remote Platform Engineer',
      company: { display_name: 'Globex' },
      location: { display_name: 'Anywhere' },
      redirect_url: 'https://www.adzuna.com/details/67890',
      description: 'Kubernetes, Terraform, on-call.',
      created: '2026-04-20T00:00:00Z',
      salary_min: null,
      salary_max: null,
    },
  ],
});

const GREENHOUSE_BODY = JSON.stringify({
  jobs: [
    {
      id: 4001,
      title: 'Software Engineer',
      location: { name: 'New York, NY' },
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4001',
      content: '&lt;p&gt;Join our team &amp; build cool stuff.&lt;/p&gt;',
      updated_at: '2026-05-03T12:00:00Z',
    },
    {
      id: 4002,
      title: 'Engineering Manager',
      company_name: 'Acme Inc',
      location: { name: 'Remote - US' },
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4002',
      content: '<p>Lead a team of <strong>engineers</strong>.</p>&nbsp;Many perks.',
      updated_at: '2026-05-02T00:00:00Z',
    },
  ],
});

const LEVER_BODY = JSON.stringify([
  {
    id: 'abc-123',
    text: 'Frontend Engineer',
    categories: { location: 'Berlin, Germany' },
    hostedUrl: 'https://jobs.lever.co/widgets/abc-123',
    descriptionPlain: 'React, TypeScript, design systems.',
    description: '<p>React, TypeScript</p>',
    createdAt: 1714000000000,
  },
  {
    id: 'def-456',
    text: 'Remote Data Engineer',
    categories: { location: 'Remote' },
    hostedUrl: 'https://jobs.lever.co/widgets/def-456',
    description: '<p>Spark &amp; <em>Airflow</em> pipelines.</p>',
    createdAt: 1715000000000,
  },
]);

const JSEARCH_BODY = JSON.stringify({
  data: [
    {
      job_id: 'js-1',
      job_title: 'DevOps Engineer',
      employer_name: 'Initech',
      job_city: 'Austin',
      job_state: 'TX',
      job_country: 'US',
      job_apply_link: 'https://jobs.example.com/js-1',
      job_description: 'CI/CD, AWS, Terraform.',
      job_posted_at_timestamp: 1714500000,
      job_is_remote: false,
      job_min_salary: 110000,
      job_max_salary: 140000,
      job_salary_currency: 'USD',
    },
  ],
});

function findById(jobs: DiscoveredJob[], id: string): DiscoveredJob {
  const j = jobs.find((x) => x.id === id);
  if (!j) throw new Error(`no job with id ${id} (have: ${jobs.map((x) => x.id).join(',')})`);
  return j;
}

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------

describe('stripHtml', () => {
  it('strips tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>world</b></p>\n\n<div>again</div>')).toBe('Hello world again');
  });

  it('decodes common entities', () => {
    expect(stripHtml('A &amp; B &quot;q&quot; &#39;a&#39;&nbsp;end')).toBe('A & B "q" \'a\' end');
  });

  it('decodes entities before stripping tags, so HTML-encoded markup is unwrapped', () => {
    // Greenhouse delivers JD bodies HTML-encoded: &lt;p&gt;...&lt;/p&gt;
    expect(stripHtml('&lt;p&gt;Join &amp; build.&lt;/p&gt;')).toBe('Join & build.');
    // ...which also means a literal "&lt;tag&gt;" becomes a stripped tag.
    expect(stripHtml('see &lt;b&gt;bold&lt;/b&gt; text')).toBe('see bold text');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Adzuna adapter
// ---------------------------------------------------------------------------

describe('discoverJobs — Adzuna', () => {
  const config: DiscoveryConfig = { adzunaAppId: 'id1', adzunaAppKey: 'key1', country: 'us' };

  it('normalises Adzuna results', () => {
    stubFetch([{ match: 'api.adzuna.com', body: ADZUNA_BODY }]);
    const jobs = discoverJobs(config, ['backend engineer']);
    expect(jobs.length).toBe(2);
    const j = findById(jobs, 'adzuna:12345');
    expect(j.source).toBe('adzuna');
    expect(j.company).toBe('Acme Corp');
    expect(j.title).toBe('Senior Backend Engineer');
    expect(j.location).toBe('San Francisco, CA');
    expect(j.url).toBe('https://www.adzuna.com/details/12345');
    expect(j.descriptionText).toContain('scalable services');
    expect(j.postedAt).toBe(Date.parse('2026-05-01T09:00:00Z'));
    expect(j.salaryMin).toBe(150000);
    expect(j.salaryMax).toBe(200000);
    expect(j.salaryCurrency).toBe('USD');
    expect(j.remote).toBeNull();
    expect(typeof j.discoveredAt).toBe('number');
  });

  it('detects remote from the Adzuna title', () => {
    stubFetch([{ match: 'api.adzuna.com', body: ADZUNA_BODY }]);
    const jobs = discoverJobs(config, ['anything']);
    expect(findById(jobs, 'adzuna:67890').remote).toBe(true);
  });

  it('issues one request per search query', () => {
    const fetch = stubFetch([{ match: 'api.adzuna.com', body: JSON.stringify({ results: [] }) }]);
    discoverJobs(config, ['a', 'b', 'c']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('uses the configured country in the URL and currency', () => {
    const fetch = stubFetch([{ match: 'api.adzuna.com', body: JSON.stringify({ results: [
      { id: '1', title: 't', company: { display_name: 'c' }, location: { display_name: 'London' },
        redirect_url: 'u', description: 'd', created: '2026-01-01T00:00:00Z', salary_min: 1, salary_max: 2 },
    ] }) }]);
    const jobs = discoverJobs({ adzunaAppId: 'i', adzunaAppKey: 'k', country: 'gb' }, ['x']);
    expect(fetch.mock.calls[0][0]).toContain('/jobs/gb/search/1');
    expect(jobs[0].salaryCurrency).toBe('GBP');
  });

  it('is disabled when creds are missing', () => {
    const fetch = stubFetch([{ match: 'api.adzuna.com', body: ADZUNA_BODY }]);
    expect(discoverJobs({ adzunaAppId: 'id-only' }, ['x'])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Greenhouse adapter
// ---------------------------------------------------------------------------

describe('discoverJobs — Greenhouse', () => {
  const config: DiscoveryConfig = { greenhouseBoards: ['acme'] };

  it('normalises Greenhouse jobs and strips HTML from content', () => {
    stubFetch([{ match: 'boards-api.greenhouse.io', body: GREENHOUSE_BODY }]);
    const jobs = discoverJobs(config);
    expect(jobs.length).toBe(2);
    const j1 = findById(jobs, 'greenhouse:acme:4001');
    expect(j1.source).toBe('greenhouse');
    expect(j1.company).toBe('acme');
    expect(j1.title).toBe('Software Engineer');
    expect(j1.location).toBe('New York, NY');
    expect(j1.url).toBe('https://boards.greenhouse.io/acme/jobs/4001');
    expect(j1.descriptionText).toBe('Join our team & build cool stuff.');
    expect(j1.postedAt).toBe(Date.parse('2026-05-03T12:00:00Z'));
    expect(j1.remote).toBeNull();

    const j2 = findById(jobs, 'greenhouse:acme:4002');
    expect(j2.company).toBe('Acme Inc'); // company_name preferred when present
    expect(j2.descriptionText).toBe('Lead a team of engineers . Many perks.');
    expect(j2.remote).toBe(true); // "Remote - US"
  });

  it('polls each board token', () => {
    const fetch = stubFetch([{ match: 'boards-api.greenhouse.io', body: JSON.stringify({ jobs: [] }) }]);
    discoverJobs({ greenhouseBoards: ['a', 'b'] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is disabled when no boards configured', () => {
    const fetch = stubFetch([{ match: 'boards-api.greenhouse.io', body: GREENHOUSE_BODY }]);
    expect(discoverJobs({ greenhouseBoards: [] })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lever adapter
// ---------------------------------------------------------------------------

describe('discoverJobs — Lever', () => {
  const config: DiscoveryConfig = { leverClients: ['widgets'] };

  it('normalises Lever postings (descriptionPlain preferred)', () => {
    stubFetch([{ match: 'api.lever.co', body: LEVER_BODY }]);
    const jobs = discoverJobs(config);
    expect(jobs.length).toBe(2);
    const j1 = findById(jobs, 'lever:widgets:abc-123');
    expect(j1.source).toBe('lever');
    expect(j1.company).toBe('widgets');
    expect(j1.title).toBe('Frontend Engineer');
    expect(j1.location).toBe('Berlin, Germany');
    expect(j1.url).toBe('https://jobs.lever.co/widgets/abc-123');
    expect(j1.descriptionText).toBe('React, TypeScript, design systems.');
    expect(j1.postedAt).toBe(1714000000000);
    expect(j1.remote).toBeNull();
  });

  it('falls back to stripped HTML description when descriptionPlain absent', () => {
    stubFetch([{ match: 'api.lever.co', body: LEVER_BODY }]);
    const jobs = discoverJobs(config);
    const j2 = findById(jobs, 'lever:widgets:def-456');
    expect(j2.descriptionText).toBe('Spark & Airflow pipelines.');
    expect(j2.remote).toBe(true);
  });

  it('is disabled when no clients configured', () => {
    const fetch = stubFetch([{ match: 'api.lever.co', body: LEVER_BODY }]);
    expect(discoverJobs({})).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// USAJOBS adapter (stub)
// ---------------------------------------------------------------------------

describe('discoverJobs — USAJOBS', () => {
  it('returns nothing and does not fetch when enabled-but-keyless', () => {
    const fetch = stubFetch([]);
    expect(discoverJobs({ usajobs: true }, ['analyst'])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is disabled when usajobs is not true', () => {
    stubFetch([]);
    expect(discoverJobs({ usajobs: false })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSearch adapter
// ---------------------------------------------------------------------------

describe('discoverJobs — JSearch', () => {
  const config: DiscoveryConfig = { jsearchRapidApiKey: 'rapid-key' };

  it('normalises JSearch data', () => {
    stubFetch([{ match: 'jsearch.p.rapidapi.com', body: JSEARCH_BODY }]);
    const jobs = discoverJobs(config, ['devops']);
    expect(jobs.length).toBe(1);
    const j = findById(jobs, 'jsearch:js-1');
    expect(j.source).toBe('jsearch');
    expect(j.company).toBe('Initech');
    expect(j.title).toBe('DevOps Engineer');
    expect(j.location).toBe('Austin, TX, US');
    expect(j.url).toBe('https://jobs.example.com/js-1');
    expect(j.postedAt).toBe(1714500000 * 1000);
    expect(j.salaryMin).toBe(110000);
    expect(j.salaryCurrency).toBe('USD');
    expect(j.remote).toBeNull();
  });

  it('passes the RapidAPI headers', () => {
    const fetch = stubFetch([{ match: 'jsearch.p.rapidapi.com', body: JSON.stringify({ data: [] }) }]);
    discoverJobs(config, ['x']);
    const opts = fetch.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(opts.headers?.['X-RapidAPI-Key']).toBe('rapid-key');
    expect(opts.headers?.['X-RapidAPI-Host']).toBe('jsearch.p.rapidapi.com');
  });

  it('is disabled when no key configured', () => {
    const fetch = stubFetch([{ match: 'jsearch.p.rapidapi.com', body: JSEARCH_BODY }]);
    expect(discoverJobs({})).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cross-source isolation
// ---------------------------------------------------------------------------

describe('discoverJobs — per-source isolation', () => {
  const config: DiscoveryConfig = {
    adzunaAppId: 'i', adzunaAppKey: 'k',
    greenhouseBoards: ['acme'],
    leverClients: ['widgets'],
  };

  it('one source 500ing does not break the others', () => {
    stubFetch([
      { match: 'api.adzuna.com', status: 500, body: 'Internal Server Error' },
      { match: 'boards-api.greenhouse.io', body: GREENHOUSE_BODY },
      { match: 'api.lever.co', body: LEVER_BODY },
    ]);
    const jobs = discoverJobs(config, ['x']);
    expect(jobs.some((j) => j.source === 'adzuna')).toBe(false);
    expect(jobs.some((j) => j.source === 'greenhouse')).toBe(true);
    expect(jobs.some((j) => j.source === 'lever')).toBe(true);
  });

  it('malformed JSON from a source is skipped, others still parsed', () => {
    stubFetch([
      { match: 'api.adzuna.com', body: '{not valid json' },
      { match: 'boards-api.greenhouse.io', body: GREENHOUSE_BODY },
      { match: 'api.lever.co', body: LEVER_BODY },
    ]);
    const jobs = discoverJobs(config, ['x']);
    expect(jobs.some((j) => j.source === 'adzuna')).toBe(false);
    expect(jobs.filter((j) => j.source === 'greenhouse').length).toBe(2);
    expect(jobs.filter((j) => j.source === 'lever').length).toBe(2);
  });

  it('returns an empty list when UrlFetchApp is unavailable (test env)', () => {
    // No stubGlobal here — UrlFetchApp is undefined.
    expect(discoverJobs(config, ['x'])).toEqual([]);
  });

  it('returns nothing when config enables no sources', () => {
    stubFetch([]);
    expect(discoverJobs({})).toEqual([]);
  });

  it('stamps discoveredAt on every job across sources', () => {
    stubFetch([
      { match: 'api.adzuna.com', body: ADZUNA_BODY },
      { match: 'boards-api.greenhouse.io', body: GREENHOUSE_BODY },
      { match: 'api.lever.co', body: LEVER_BODY },
    ]);
    const before = Date.now();
    const jobs = discoverJobs(config, ['x']);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.discoveredAt).toBeGreaterThanOrEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------
// dedupJobs
// ---------------------------------------------------------------------------

describe('dedupJobs', () => {
  function jobWith(id: string, desc: string): DiscoveredJob {
    return {
      id, source: 'adzuna', company: 'c', title: 't', location: null, remote: null,
      url: 'u', descriptionText: desc, postedAt: null, discoveredAt: 1, salaryMin: null,
      salaryMax: null, salaryCurrency: null,
    };
  }

  it('keeps the duplicate with the longer description', () => {
    const out = dedupJobs([jobWith('x', 'short'), jobWith('x', 'a much longer description'), jobWith('y', 'only')]);
    expect(out.length).toBe(2);
    expect(findById(out, 'x').descriptionText).toBe('a much longer description');
    expect(findById(out, 'y').descriptionText).toBe('only');
  });

  it('is a no-op when there are no duplicates', () => {
    const input = [jobWith('a', '1'), jobWith('b', '22')];
    expect(dedupJobs(input)).toEqual(input);
  });
});
