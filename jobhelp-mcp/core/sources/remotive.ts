import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  asString,
  classifyHttpStatus,
  isRecord,
} from './_shared.js';

export { SourceFetchError };

const REMOTIVE_BASE = 'https://remotive.com/api/remote-jobs';

interface RemotiveJob {
  readonly id: number | string;
  readonly url: string;
  readonly title: string;
  readonly companyName: string;
  readonly publicationDate: string | undefined;
  readonly salary: string | undefined;
  readonly description: string;
  readonly location: string;
}

function parseRemotiveJob(raw: unknown): RemotiveJob | undefined {
  if (!isRecord(raw)) return undefined;
  const rawId = raw['id'];
  const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? rawId : undefined;
  if (id === undefined) return undefined;
  const url = asString(raw['url']);
  const title = asString(raw['title']);
  const companyName = asString(raw['company_name']);
  if (url === undefined || title === undefined || companyName === undefined) return undefined;
  return {
    id,
    url,
    title,
    companyName,
    publicationDate: asString(raw['publication_date']),
    salary: asString(raw['salary']),
    description: asString(raw['description']) ?? '',
    location: asString(raw['candidate_required_location']) ?? '',
  };
}

function normalize(job: RemotiveJob): NormalizedJob {
  const norm: NormalizedJob = {
    id: `remotive:${String(job.id)}`,
    source: 'remotive',
    url: job.url,
    title: job.title,
    company: job.companyName,
    location: job.location,
    remote: 'remote',
    description: job.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(job.publicationDate);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

function buildUrl(query: string | undefined, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query !== undefined && query.length > 0) {
    params.set('search', query);
  }
  return `${REMOTIVE_BASE}?${params.toString()}`;
}

async function fetchOne(
  query: string | undefined,
  limit: number,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const url = buildUrl(query, limit);
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `remotive network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `remotive HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'remotive response was not valid JSON');
  }
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'remotive response was not an object');
  }
  const jobs = body['jobs'];
  if (!Array.isArray(jobs)) {
    throw new SourceFetchError('parse', 'remotive response.jobs was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawJob of jobs) {
    const parsed = parseRemotiveJob(rawJob);
    if (parsed === undefined) continue;
    const job = normalize(parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const remotive: SourceAdapter = {
  name: 'remotive',
  enabled: (config): boolean => Boolean(config.sources.remotive),
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const cfg = config.sources.remotive;
    if (!cfg) return [];
    const accept = opts?.accept;
    const http = opts?.http;
    const queries = cfg.queries?.length ? cfg.queries : [undefined];
    const limit = cfg.limit ?? 100;
    const pool: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: SourceFetchError | undefined;
    for (const q of queries) {
      attempts += 1;
      try {
        const jobs = await fetchOne(q, limit, accept, http);
        pool.push(...jobs);
      } catch (err: unknown) {
        failures += 1;
        if (err instanceof SourceFetchError) lastError = err;
        log('warn', 'remotive: query failed', {
          query: q ?? '<all>',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (failures === attempts && lastError !== undefined) throw lastError;
    return pool;
  },
};
