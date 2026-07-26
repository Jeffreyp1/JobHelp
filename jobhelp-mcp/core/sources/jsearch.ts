import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

export { SourceFetchError };

// RapidAPI free tier is rate-limited; keep query fan-out modest.
const JSEARCH_CONCURRENCY = 3;
const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const DEFAULT_QUERY = 'software engineer';

interface JSearchJob {
  readonly jobId: string;
  readonly title: string;
  readonly company: string;
  readonly applyLink: string;
  readonly description: string;
  readonly city: string | undefined;
  readonly country: string | undefined;
  readonly isRemote: boolean;
  readonly postedTimestamp: number | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

// job_posted_at_timestamp is UNIX seconds; convert to ISO-8601.
function epochToIso(epoch: number | undefined): string | undefined {
  if (epoch === undefined) return undefined;
  const d = new Date(epoch * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function parseJSearchJob(raw: unknown): JSearchJob | undefined {
  if (!isRecord(raw)) return undefined;
  const jobId = asString(raw['job_id']);
  const title = asString(raw['job_title']);
  const applyLink = asString(raw['job_apply_link']);
  if (jobId === undefined || title === undefined || applyLink === undefined) return undefined;
  return {
    jobId,
    title,
    company: asString(raw['employer_name']) ?? 'Unknown',
    applyLink,
    description: asString(raw['job_description']) ?? '',
    city: asString(raw['job_city']),
    country: asString(raw['job_country']),
    isRemote: raw['job_is_remote'] === true,
    postedTimestamp: asNumber(raw['job_posted_at_timestamp']),
    salaryMin: asNumber(raw['job_min_salary']),
    salaryMax: asNumber(raw['job_max_salary']),
    salaryCurrency: asString(raw['job_salary_currency']),
  };
}

function buildLocation(job: JSearchJob): string {
  return [job.city, job.country].filter((p): p is string => p !== undefined && p.length > 0).join(', ');
}

function normalize(job: JSearchJob): NormalizedJob {
  const location = buildLocation(job);
  const remote = job.isRemote ? 'remote' : detectRemoteMode(`${job.title} ${job.description}`);
  const norm: NormalizedJob = {
    id: `jsearch:${job.jobId}`,
    source: 'jsearch',
    url: job.applyLink,
    title: job.title,
    company: job.company,
    location,
    remote,
    description: job.description,
    ...(job.salaryMin !== undefined ? { salaryMin: job.salaryMin } : {}),
    ...(job.salaryMax !== undefined ? { salaryMax: job.salaryMax } : {}),
    ...(job.salaryCurrency !== undefined ? { salaryCurrency: job.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = epochToIso(job.postedTimestamp);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

function buildUrl(query: string): string {
  // num_pages is JSearch's multi-page fetch in a single billed request (max 20):
  // one call returns ~10 jobs/page * num_pages, not 20 separate quota hits.
  const params = new URLSearchParams({ query, page: '1', num_pages: '20' });
  return `https://${JSEARCH_HOST}/search?${params.toString()}`;
}

async function fetchOnePage(url: string, rapidApiKey: string, http?: SharedHttpOptions): Promise<unknown> {
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, {
      headers: { 'X-RapidAPI-Key': rapidApiKey, 'X-RapidAPI-Host': JSEARCH_HOST },
      ...http,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `jsearch network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `jsearch HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'jsearch response was not valid JSON');
  }
}

async function fetchQueryJobs(
  query: string,
  rapidApiKey: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const body = await fetchOnePage(buildUrl(query), rapidApiKey, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'jsearch response was not an object');
  }
  if (body['status'] !== 'OK') {
    throw new SourceFetchError('client', `jsearch response status was not OK: ${asString(body['status']) ?? 'unknown'}`);
  }
  const data = body['data'];
  if (!Array.isArray(data)) {
    throw new SourceFetchError('parse', 'jsearch response.data was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawJob of data) {
    const parsed = parseJSearchJob(rawJob);
    if (parsed === undefined) continue;
    const job = normalize(parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const jsearch: SourceAdapter = {
  name: 'jsearch',
  enabled: (config): boolean => {
    const c = config.sources.jsearch;
    return c !== undefined && c.rapidApiKey.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.jsearch;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'jsearch config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const queries = c.queries !== undefined && c.queries.length > 0 ? c.queries : [DEFAULT_QUERY];
    const tasks = queries.map((query) => (): Promise<NormalizedJob[]> => fetchQueryJobs(query, c.rapidApiKey, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: JSEARCH_CONCURRENCY });
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
        log('warn', 'jsearch fetch failed', {
          query: queries[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (queries.length > 0 && failures === queries.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'jsearch: all queries failed');
    }
    return all;
  },
};
