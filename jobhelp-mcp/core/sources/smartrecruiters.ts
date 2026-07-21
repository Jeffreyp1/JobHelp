import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
} from './_shared.js';

export { SourceFetchError };

interface SmartRecruitersPosting {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly location: string;
  readonly company: string;
  readonly publishedAt: string | undefined;
}

function buildLocation(raw: unknown): string {
  if (!isRecord(raw)) return '';
  const city = asString(raw['city']);
  const region = asString(raw['region']);
  const country = asString(raw['country']);
  const remote = raw['remote'] === true;
  const parts: string[] = [];
  if (city !== undefined && city.length > 0) parts.push(city);
  if (region !== undefined && region.length > 0) parts.push(region);
  if (country !== undefined && country.length > 0) parts.push(country);
  const joined = parts.join(', ');
  if (remote) return joined.length > 0 ? `${joined} (Remote)` : 'Remote';
  return joined;
}

function buildApplyUrl(slug: string, postingId: string): string {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(postingId)}`;
}

function parsePosting(slug: string, raw: unknown): SmartRecruitersPosting | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']) ?? asString(raw['uuid']);
  const title = asString(raw['name']);
  if (id === undefined || title === undefined) return undefined;
  const companyObj = raw['company'];
  const company = isRecord(companyObj) ? asString(companyObj['name']) ?? slug : slug;
  const location = buildLocation(raw['location']);
  const publishedAt = asString(raw['releasedDate']) ?? asString(raw['createdOn']);
  const url = buildApplyUrl(slug, id);
  return {
    id,
    title,
    url,
    description: '',
    location,
    company,
    publishedAt,
  };
}

function normalize(slug: string, p: SmartRecruitersPosting): NormalizedJob {
  const remote = detectRemoteMode(`${p.title} ${p.location} ${p.description}`);
  const norm: NormalizedJob = {
    id: `smartrecruiters:${p.id}`,
    source: 'smartrecruiters',
    url: p.url,
    title: p.title,
    company: p.company.length > 0 ? p.company : slug,
    location: p.location,
    remote,
    description: p.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(p.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string, http?: SharedHttpOptions): Promise<{ totalFound: number; content: unknown[] }> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `smartrecruiters network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `smartrecruiters HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'smartrecruiters response was not valid JSON');
  }
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'smartrecruiters response was not an object');
  }
  const totalFoundRaw = body['totalFound'];
  const totalFound = typeof totalFoundRaw === 'number' ? totalFoundRaw : 0;
  const content = body['content'];
  if (!Array.isArray(content)) {
    throw new SourceFetchError('parse', 'smartrecruiters response.content was not an array');
  }
  if (totalFound === 0 && content.length === 0) {
    throw new SourceFetchError('not_found', 'smartrecruiters: totalFound=0 — likely invalid slug');
  }
  return { totalFound, content };
}

async function fetchAndCollect(
  slug: string,
  out: NormalizedJob[],
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<void> {
  const { content } = await fetchBoard(slug, http);
  for (const raw of content) {
    const parsed = parsePosting(slug, raw);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
}

export const smartrecruiters: SourceAdapter = {
  name: 'smartrecruiters',
  enabled: (config): boolean => {
    const c = config.sources.smartrecruiters;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.smartrecruiters;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'smartrecruiters config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const results = await Promise.allSettled(
      c.tokens.map(async (slug: string): Promise<{ slug: string; jobs: NormalizedJob[] }> => {
        const local: NormalizedJob[] = [];
        await fetchAndCollect(slug, local, accept, http);
        return { slug, jobs: local };
      }),
    );
    const all: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: unknown;
    for (let i = 0; i < results.length; i += 1) {
      attempts += 1;
      const r = results[i];
      if (r === undefined) continue;
      const slug = c.tokens[i] ?? '';
      if (r.status === 'fulfilled') {
        all.push(...r.value.jobs);
      } else {
        failures += 1;
        lastError = r.reason;
        log('warn', 'smartrecruiters fetch failed', {
          slug,
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'smartrecruiters: all tokens failed');
    }
    return all;
  },
};
