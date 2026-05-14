import { log } from '../lib/log.js';
import type { JobDigestConfig } from '../types/config.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { SourceAdapter, SourceErrorType } from '../types/source.js';

/** Typed transport error every source adapter raises through {@link httpFail}. */
export class SourceFetchError extends Error {
  readonly type: SourceErrorType;
  constructor(type: SourceErrorType, message: string) {
    super(message);
    this.name = 'SourceFetchError';
    this.type = type;
  }
}

function classifyHttpStatus(status: number): SourceErrorType {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'network';
  if (status >= 400) return 'network';
  return 'unknown';
}

function detectRemoteMode(text: string): RemoteMode {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(remote|wfh|work[- ]from[- ]home)\b/.test(t)) return 'remote';
  if (/\b(on[- ]?site|in[- ]office)\b/.test(t)) return 'onsite';
  return 'unknown';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

function asIsoString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
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

function normalize(result: AdzunaResult, raw: unknown): NormalizedJob {
  const remoteText = `${result.title} ${result.description} ${result.location}`;
  const remote = detectRemoteMode(remoteText);
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
    ...((result.salaryMin !== undefined || result.salaryMax !== undefined) ? { salaryCurrency: 'USD' } : {}),
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
    for (const query of c.queries) {
      const url = buildUrl(c.country, query, c.appId, c.appKey);
      let body: unknown;
      try {
        body = await fetchOnePage(url);
      } catch (err: unknown) {
        log('warn', 'adzuna fetch failed', { query, error: err instanceof Error ? err.message : 'unknown' });
        throw err;
      }
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
        all.push(normalize(parsed, rawResult));
      }
    }
    return all;
  },
};
