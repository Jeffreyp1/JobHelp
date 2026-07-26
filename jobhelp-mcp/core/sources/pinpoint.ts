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

export { SourceFetchError };

// Each slug is its own *.pinpointhq.com tenant, so cross-slug parallelism is rate-limit safe.
const MAX_CONCURRENT = 10;

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface PinpointPosting {
  readonly id: string;
  readonly title: string;
  readonly applicationUrl: string;
  readonly description: string;
  readonly location: string;
  readonly publishedAt: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

function locationFromValue(loc: unknown): string {
  if (typeof loc === 'string') return loc;
  if (isRecord(loc)) {
    const city = asString(loc['city']);
    const province = asString(loc['province']) ?? asString(loc['state']) ?? asString(loc['region']);
    const country = asString(loc['country']) ?? asString(loc['country_name']);
    const name = asString(loc['name']);
    const parts: string[] = [];
    if (city !== undefined && city.length > 0) parts.push(city);
    if (province !== undefined && province.length > 0) parts.push(province);
    if (country !== undefined && country.length > 0) parts.push(country);
    if (parts.length > 0) return parts.join(', ');
    if (name !== undefined) return name;
  }
  return '';
}

// Pinpoint serves a flat shape; some boards wrap fields in JSON:API `attributes` — accept both.
function parsePinpointPosting(raw: unknown): PinpointPosting | undefined {
  if (!isRecord(raw)) return undefined;
  const rawId = raw['id'];
  const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : undefined;
  if (id === undefined) return undefined;
  const attrsRaw = raw['attributes'];
  const attrs: Record<string, unknown> = isRecord(attrsRaw) ? attrsRaw : raw;
  const title = asString(attrs['title']);
  const applicationUrl = asString(attrs['application_url']) ?? asString(attrs['url']);
  if (title === undefined || applicationUrl === undefined) return undefined;
  const description = stripHtml(asString(attrs['description']) ?? '');
  const location = locationFromValue(attrs['location']);
  const publishedAt =
    asString(attrs['posted_at']) ?? asString(attrs['published_at']) ?? asString(attrs['created_at']);
  const compensation = attrs['compensation'];
  let salaryMin: number | undefined;
  let salaryMax: number | undefined;
  let salaryCurrency: string | undefined;
  if (isRecord(compensation)) {
    salaryMin = asNumber(compensation['min']) ?? asNumber(compensation['minimum']);
    salaryMax = asNumber(compensation['max']) ?? asNumber(compensation['maximum']);
    salaryCurrency = asString(compensation['currency']);
  }
  if (salaryMin === undefined) salaryMin = asNumber(attrs['compensation_minimum']) ?? asNumber(attrs['salary_min']);
  if (salaryMax === undefined) salaryMax = asNumber(attrs['compensation_maximum']) ?? asNumber(attrs['salary_max']);
  if (salaryCurrency === undefined) salaryCurrency = asString(attrs['compensation_currency']) ?? asString(attrs['salary_currency']);
  return {
    id,
    title,
    applicationUrl,
    description,
    location,
    publishedAt,
    salaryMin,
    salaryMax,
    salaryCurrency,
  };
}

function normalize(slug: string, posting: PinpointPosting): NormalizedJob {
  const remote = detectRemoteMode(`${posting.title} ${posting.location} ${posting.description}`);
  const norm: NormalizedJob = {
    id: `pinpoint:${posting.id}`,
    source: 'pinpoint',
    url: posting.applicationUrl,
    title: posting.title,
    company: slug,
    location: posting.location,
    remote,
    description: posting.description,
    ...(posting.salaryMin !== undefined ? { salaryMin: posting.salaryMin } : {}),
    ...(posting.salaryMax !== undefined ? { salaryMax: posting.salaryMax } : {}),
    ...(posting.salaryCurrency !== undefined ? { salaryCurrency: posting.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(posting.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string, http?: SharedHttpOptions): Promise<unknown> {
  const url = `https://${encodeURIComponent(slug)}.pinpointhq.com/postings.json`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `pinpoint network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `pinpoint HTTP ${response.status}`);
  }
  const contentType = response.contentType;
  if (!contentType.toLowerCase().includes('json')) {
    throw new SourceFetchError('not_found', `pinpoint: non-JSON content-type (${contentType}) — likely invalid slug`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'pinpoint response was not valid JSON');
  }
}

async function fetchAndCollect(
  slug: string,
  out: NormalizedJob[],
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<void> {
  const body = await fetchBoard(slug, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'pinpoint response was not an object');
  }
  const data = body['data'];
  if (!Array.isArray(data)) {
    throw new SourceFetchError('parse', 'pinpoint response.data was not an array');
  }
  for (const raw of data) {
    const parsed = parsePinpointPosting(raw);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
}

export const pinpoint: SourceAdapter = {
  name: 'pinpoint',
  enabled: (config): boolean => {
    const c = config.sources.pinpoint;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.pinpoint;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'pinpoint config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const tasks = c.tokens.map((slug) => async (): Promise<{ slug: string; jobs: NormalizedJob[] }> => {
      const local: NormalizedJob[] = [];
      await fetchAndCollect(slug, local, accept, http);
      return { slug, jobs: local };
    });
    const results = await runWithConcurrency(tasks, { limit: MAX_CONCURRENT });
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
        log('warn', 'pinpoint fetch failed', {
          slug,
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'pinpoint: all tokens failed');
    }
    return all;
  },
};
