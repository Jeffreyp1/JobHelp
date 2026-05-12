/**
 * Job-discovery library: poll configured sources, normalise to DiscoveredJob[].
 *
 * Pure UrlFetchApp-driven module. One adapter per source; each adapter is
 * isolated — a single source failing (network, non-2xx, malformed JSON) logs a
 * `warn` and is skipped, never aborting the others.
 *
 * Search-query contract: `DiscoveryConfig` does not carry search queries (those
 * live on `JobProfile.searchQueries`), so the aggregator adapters that need a
 * `what`/`query` term (Adzuna, USAJOBS, JSearch) take them via the optional
 * second parameter — the caller passes `profile.searchQueries`.
 */

import type { DiscoveredJob, DiscoveryConfig, JobSource } from '../types/job-discovery.js';
import { log } from './structuredLog.js';

// ---------------------------------------------------------------------------
// Apps Script UrlFetchApp ambient declaration (production + tests)
// ---------------------------------------------------------------------------

declare const UrlFetchApp: {
  fetch(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      muteHttpExceptions?: boolean;
    },
  ): {
    getResponseCode(): number;
    getContentText(): string;
  };
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface FetchResult {
  status: number;
  text: string;
}

/** GET `url`, returning {status, text} — or null if UrlFetchApp is unavailable. */
function httpGet(url: string, headers?: Record<string, string>): FetchResult | null {
  if (typeof UrlFetchApp === 'undefined') return null;
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    ...(headers ? { headers } : {}),
  });
  return { status: resp.getResponseCode(), text: resp.getContentText() };
}

/** GET + JSON-parse `url`. Returns the parsed value, or null on any failure
 *  (UrlFetchApp absent, non-2xx, network throw, malformed JSON) — logs a warn. */
function fetchJson(source: JobSource, url: string, headers?: Record<string, string>): unknown {
  let res: FetchResult | null;
  try {
    res = httpGet(url, headers);
  } catch (err) {
    log('warn', 'jobDiscovery: fetch threw', { source, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (res === null) return null;
  if (res.status < 200 || res.status >= 300) {
    log('warn', 'jobDiscovery: non-2xx response', { source, status: res.status });
    return null;
  }
  try {
    return JSON.parse(res.text);
  } catch (err) {
    log('warn', 'jobDiscovery: malformed JSON', { source, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML stripping
// ---------------------------------------------------------------------------

/**
 * Decode the common HTML entities, strip tags, collapse whitespace.
 * Entities are decoded BEFORE tag-stripping so HTML-encoded markup (e.g.
 * Greenhouse's `&lt;p&gt;...&lt;/p&gt;` content) gets unwrapped too. `&amp;`
 * is decoded last so `&amp;lt;` resolves correctly.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Common field helpers
// ---------------------------------------------------------------------------

/** "remote" if the location or title mentions it (case-insensitive), else null. */
function detectRemote(location: string | null, title: string | null): boolean | null {
  const hay = `${location ?? ''} ${title ?? ''}`.toLowerCase();
  return hay.includes('remote') ? true : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Date.parse with a finite-result guard. */
function parseDate(v: unknown): number | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Currency code by Adzuna country (best-effort; null for unknown). */
function currencyForCountry(country: string): string | null {
  const map: Record<string, string> = {
    us: 'USD', gb: 'GBP', au: 'AUD', ca: 'CAD', de: 'EUR', fr: 'EUR',
    nl: 'EUR', at: 'EUR', it: 'EUR', es: 'EUR', pl: 'PLN', br: 'BRL',
    in: 'INR', za: 'ZAR', sg: 'SGD', nz: 'NZD',
  };
  return map[country.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function discoverAdzuna(config: DiscoveryConfig, searchQueries: string[], now: number): DiscoveredJob[] {
  if (!config.adzunaAppId || !config.adzunaAppKey) return [];
  const country = (config.country || 'us').toLowerCase();
  const currency = currencyForCountry(country);
  const queries = searchQueries.length > 0 ? searchQueries : [''];
  const out: DiscoveredJob[] = [];
  for (const q of queries) {
    try {
      const url =
        `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1` +
        `?app_id=${encodeURIComponent(config.adzunaAppId)}` +
        `&app_key=${encodeURIComponent(config.adzunaAppKey)}` +
        `&results_per_page=50&what=${encodeURIComponent(q)}`;
      const json = fetchJson('adzuna', url);
      if (!isObj(json)) continue;
      for (const r of arr(json['results'])) {
        if (!isObj(r)) continue;
        const companyObj = isObj(r['company']) ? r['company'] : {};
        const locObj = isObj(r['location']) ? r['location'] : {};
        const location = asString(locObj['display_name']);
        const title = asString(r['title']) ?? '';
        out.push({
          id: 'adzuna:' + String(r['id']),
          source: 'adzuna',
          company: asString(companyObj['display_name']) ?? 'unknown',
          title,
          location,
          remote: detectRemote(location, title),
          url: asString(r['redirect_url']) ?? '',
          descriptionText: asString(r['description']) ?? '',
          postedAt: parseDate(r['created']),
          discoveredAt: now,
          salaryMin: asNumber(r['salary_min']),
          salaryMax: asNumber(r['salary_max']),
          salaryCurrency: currency,
        });
      }
    } catch (err) {
      log('warn', 'jobDiscovery: adzuna adapter failed', { query: q, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

function discoverGreenhouse(config: DiscoveryConfig, now: number): DiscoveredJob[] {
  if (!config.greenhouseBoards || config.greenhouseBoards.length === 0) return [];
  const out: DiscoveredJob[] = [];
  for (const token of config.greenhouseBoards) {
    try {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const json = fetchJson('greenhouse', url);
      if (!isObj(json)) continue;
      for (const job of arr(json['jobs'])) {
        if (!isObj(job)) continue;
        const locObj = isObj(job['location']) ? job['location'] : {};
        const location = asString(locObj['name']);
        const title = asString(job['title']) ?? '';
        out.push({
          id: 'greenhouse:' + token + ':' + String(job['id']),
          source: 'greenhouse',
          company: asString(job['company_name']) ?? token,
          title,
          location,
          remote: detectRemote(location, title),
          url: asString(job['absolute_url']) ?? '',
          descriptionText: stripHtml(asString(job['content']) ?? ''),
          postedAt: parseDate(job['updated_at']),
          discoveredAt: now,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
    } catch (err) {
      log('warn', 'jobDiscovery: greenhouse adapter failed', { token, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

function discoverLever(config: DiscoveryConfig, now: number): DiscoveredJob[] {
  if (!config.leverClients || config.leverClients.length === 0) return [];
  const out: DiscoveredJob[] = [];
  for (const client of config.leverClients) {
    try {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(client)}?mode=json`;
      const json = fetchJson('lever', url);
      if (!Array.isArray(json)) continue;
      for (const posting of json) {
        if (!isObj(posting)) continue;
        const cats = isObj(posting['categories']) ? posting['categories'] : {};
        const location = asString(cats['location']);
        const title = asString(posting['text']) ?? '';
        const descPlain = asString(posting['descriptionPlain']);
        const descHtml = asString(posting['description']);
        out.push({
          id: 'lever:' + client + ':' + String(posting['id']),
          source: 'lever',
          company: client,
          title,
          location,
          remote: detectRemote(location, title),
          url: asString(posting['hostedUrl']) ?? '',
          descriptionText: descPlain ?? (descHtml ? stripHtml(descHtml) : ''),
          postedAt: asNumber(posting['createdAt']),
          discoveredAt: now,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
    } catch (err) {
      log('warn', 'jobDiscovery: lever adapter failed', { client, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

function discoverUsajobs(config: DiscoveryConfig, _searchQueries: string[], _now: number): DiscoveredJob[] {
  if (config.usajobs !== true) return [];
  // DiscoveryConfig as scaffolded carries no USAJOBS API key / registered email,
  // both of which the API requires. Treat as a best-effort stub until the config
  // is extended (see CROSS-IMPACT in the report).
  log('info', 'jobDiscovery: usajobs enabled but no API key configured — skipping');
  return [];
}

function discoverJsearch(config: DiscoveryConfig, searchQueries: string[], now: number): DiscoveredJob[] {
  if (!config.jsearchRapidApiKey) return [];
  const queries = searchQueries.length > 0 ? searchQueries : [''];
  const headers = {
    'X-RapidAPI-Key': config.jsearchRapidApiKey,
    'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
  };
  const out: DiscoveredJob[] = [];
  for (const q of queries) {
    try {
      const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&date_posted=week`;
      const json = fetchJson('jsearch', url, headers);
      if (!isObj(json)) continue;
      for (const item of arr(json['data'])) {
        if (!isObj(item)) continue;
        const cityState = [asString(item['job_city']), asString(item['job_state']), asString(item['job_country'])]
          .filter((s): s is string => !!s)
          .join(', ');
        const location = cityState || null;
        const title = asString(item['job_title']) ?? '';
        const isRemoteFlag = item['job_is_remote'] === true;
        out.push({
          id: 'jsearch:' + String(item['job_id']),
          source: 'jsearch',
          company: asString(item['employer_name']) ?? 'unknown',
          title,
          location,
          remote: isRemoteFlag ? true : detectRemote(location, title),
          url: asString(item['job_apply_link']) ?? '',
          descriptionText: asString(item['job_description']) ?? '',
          postedAt: asNumber(item['job_posted_at_timestamp']) !== null
            ? (asNumber(item['job_posted_at_timestamp']) as number) * 1000
            : parseDate(item['job_posted_at_datetime_utc']),
          discoveredAt: now,
          salaryMin: asNumber(item['job_min_salary']),
          salaryMax: asNumber(item['job_max_salary']),
          salaryCurrency: asString(item['job_salary_currency']),
        });
      }
    } catch (err) {
      log('warn', 'jobDiscovery: jsearch adapter failed', { query: q, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch postings from every enabled source in `config`, normalise each to the
 * common DiscoveredJob shape, and return the merged (NOT yet deduped) list.
 * Errors from one source must not abort the others — log and continue.
 *
 * @param config        which sources to poll + their credentials/targets
 * @param searchQueries  free-text queries (from JobProfile.searchQueries) fed to
 *                       the aggregator adapters (Adzuna, USAJOBS, JSearch). The
 *                       per-company ATS adapters (Greenhouse, Lever) ignore it.
 */
export function discoverJobs(config: DiscoveryConfig, searchQueries: string[] = []): DiscoveredJob[] {
  const now = Date.now();
  const queries = Array.isArray(searchQueries) ? searchQueries.filter((q): q is string => typeof q === 'string') : [];
  const out: DiscoveredJob[] = [];

  const adapters: Array<() => DiscoveredJob[]> = [
    () => discoverAdzuna(config, queries, now),
    () => discoverGreenhouse(config, now),
    () => discoverLever(config, now),
    () => discoverUsajobs(config, queries, now),
    () => discoverJsearch(config, queries, now),
  ];

  for (const adapter of adapters) {
    try {
      const jobs = adapter();
      for (const j of jobs) out.push(j);
    } catch (err) {
      log('warn', 'jobDiscovery: adapter threw', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** Dedup by DiscoveredJob.id, keeping the entry with the more complete description. */
export function dedupJobs(jobs: DiscoveredJob[]): DiscoveredJob[] {
  const byId = new Map<string, DiscoveredJob>();
  for (const j of jobs) {
    const existing = byId.get(j.id);
    if (!existing || j.descriptionText.length > existing.descriptionText.length) {
      byId.set(j.id, j);
    }
  }
  return [...byId.values()];
}
