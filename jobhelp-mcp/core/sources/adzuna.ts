import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

// Adzuna's free tier is rate-limited; keep query fan-out modest.
const ADZUNA_CONCURRENCY = 5;

export { SourceFetchError };

interface AdzunaResult {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly redirectUrl: string;
  readonly company: string;
  readonly location: string;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly created: string | undefined;
}

const COUNTRY_TO_CURRENCY: Readonly<Record<string, string>> = {
  us: 'USD',
  gb: 'GBP',
  au: 'AUD',
  ca: 'CAD',
  de: 'EUR',
  fr: 'EUR',
  nl: 'EUR',
};

function currencyForCountry(country: string): string | undefined {
  return COUNTRY_TO_CURRENCY[country.toLowerCase()];
}

function parseAdzunaResult(raw: unknown): AdzunaResult | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']);
  const title = asString(raw['title']);
  const description = asString(raw['description']) ?? '';
  const redirectUrl = asString(raw['redirect_url']);
  if (id === undefined || title === undefined || redirectUrl === undefined) return undefined;
  const companyObj = raw['company'];
  const locationObj = raw['location'];
  const company = isRecord(companyObj) ? asString(companyObj['display_name']) ?? 'Unknown' : 'Unknown';
  const location = isRecord(locationObj) ? asString(locationObj['display_name']) ?? '' : '';
  return {
    id,
    title,
    description,
    redirectUrl,
    company,
    location,
    salaryMin: asNumber(raw['salary_min']),
    salaryMax: asNumber(raw['salary_max']),
    created: asString(raw['created']),
  };
}

function normalize(result: AdzunaResult, country: string): NormalizedJob {
  const remoteText = `${result.title} ${result.description} ${result.location}`;
  const remote = detectRemoteMode(remoteText);
  const hasSalary = result.salaryMin !== undefined || result.salaryMax !== undefined;
  const currency = hasSalary ? currencyForCountry(country) : undefined;
  const job: NormalizedJob = {
    id: `adzuna:${result.id}`,
    source: 'adzuna',
    url: result.redirectUrl,
    title: result.title,
    company: result.company,
    location: result.location,
    remote,
    description: result.description,
    ...(result.salaryMin !== undefined ? { salaryMin: result.salaryMin } : {}),
    ...(result.salaryMax !== undefined ? { salaryMax: result.salaryMax } : {}),
    ...(currency !== undefined ? { salaryCurrency: currency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(result.created);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return job;
}

function buildUrl(country: string, query: string, appId: string, appKey: string): string {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: query,
    'content-type': 'application/json',
  });
  return `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params.toString()}`;
}

async function fetchOnePage(url: string, http?: SharedHttpOptions): Promise<unknown> {
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `adzuna network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `adzuna HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'adzuna response was not valid JSON');
  }
}

async function fetchQueryJobs(
  url: string,
  country: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const body = await fetchOnePage(url, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'adzuna response was not an object');
  }
  const results = body['results'];
  if (!Array.isArray(results)) {
    throw new SourceFetchError('parse', 'adzuna response.results was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawResult of results) {
    const parsed = parseAdzunaResult(rawResult);
    if (parsed === undefined) continue;
    const job = normalize(parsed, country);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const adzuna: SourceAdapter = {
  name: 'adzuna',
  enabled: (config): boolean => {
    const c = config.sources.adzuna;
    return c !== undefined && c.appId.length > 0 && c.appKey.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.adzuna;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'adzuna config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const queries = c.queries;
    const tasks = queries.map((query) => (): Promise<NormalizedJob[]> =>
      fetchQueryJobs(buildUrl(c.country, query, c.appId, c.appKey), c.country, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: ADZUNA_CONCURRENCY });
    const all: NormalizedJob[] = [];
    let lastError: unknown;
    let failures = 0;
    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i];
      if (r === undefined) continue;
      if (r.status === 'fulfilled') {
        for (const job of r.value) all.push(job);
      } else {
        failures += 1;
        lastError = r.reason;
        log('warn', 'adzuna fetch failed', {
          query: queries[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (queries.length > 0 && failures === queries.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'adzuna: all queries failed');
    }
    return all;
  },
};
