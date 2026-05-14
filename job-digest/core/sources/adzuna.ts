import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { SourceAdapter } from '../types/source.js';
import {
  SourceFetchError,
  asIsoString,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
} from './_shared.js';

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

function normalize(result: AdzunaResult, raw: unknown, country: string): NormalizedJob {
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
    rawSourceData: raw,
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

async function fetchOnePage(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `adzuna network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `adzuna HTTP ${response.status}`);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'read failed';
    throw new SourceFetchError('network', `adzuna body read error: ${msg}`);
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'adzuna response was not valid JSON');
  }
}

async function fetchAndCollect(
  url: string,
  country: string,
  out: NormalizedJob[],
): Promise<void> {
  const body = await fetchOnePage(url);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'adzuna response was not an object');
  }
  const results = body['results'];
  if (!Array.isArray(results)) {
    throw new SourceFetchError('parse', 'adzuna response.results was not an array');
  }
  for (const rawResult of results) {
    const parsed = parseAdzunaResult(rawResult);
    if (parsed === undefined) continue;
    out.push(normalize(parsed, rawResult, country));
  }
}

export const adzuna: SourceAdapter = {
  name: 'adzuna',
  enabled: (config): boolean => {
    const c = config.sources.adzuna;
    return c !== undefined && c.appId.length > 0 && c.appKey.length > 0;
  },
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.adzuna;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'adzuna config missing');
    }
    const all: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: unknown;
    for (const query of c.queries) {
      attempts += 1;
      const url = buildUrl(c.country, query, c.appId, c.appKey);
      try {
        await fetchAndCollect(url, c.country, all);
      } catch (err: unknown) {
        failures += 1;
        lastError = err;
        log('warn', 'adzuna fetch failed', { query, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'adzuna: all queries failed');
    }
    return all;
  },
};
