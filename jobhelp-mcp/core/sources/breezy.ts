import { log } from '../lib/log.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  asString,
  classifyHttpStatus,
  detectRemoteMode as detectRemoteFromText,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

export { SourceFetchError };

// Breezy documents 100 req/60s; keep a conservative parallel cap.
// Each slug is its own *.breezy.hr tenant, so cross-slug parallelism is rate-limit safe.
const MAX_CONCURRENT = 8;

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

interface BreezyPosting {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly location: string;
  readonly remote: RemoteMode;
  readonly publishedAt: string | undefined;
}

function detectRemoteSignal(
  loc: Record<string, unknown> | undefined,
  type: unknown,
  text: string,
): RemoteMode {
  if (loc !== undefined) {
    if (loc['is_remote'] === true) return 'remote';
    const rd = loc['remote_details'];
    if (isRecord(rd)) {
      const v = asString(rd['value'])?.toLowerCase();
      if (v === 'remote') return 'remote';
      if (v === 'hybrid') return 'hybrid';
      if (v === 'onsite' || v === 'on-site' || v === 'in-person') return 'onsite';
    }
  }
  const typeStr = typeof type === 'string'
    ? type
    : isRecord(type)
    ? (asString(type['name']) ?? asString(type['id']))
    : undefined;
  if (typeStr !== undefined) {
    const t = typeStr.toLowerCase();
    if (t.includes('remote')) return 'remote';
    if (t.includes('hybrid')) return 'hybrid';
  }
  return detectRemoteFromText(text);
}

function buildLocation(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return '';
  const name = asString(raw['name']);
  if (name !== undefined) return name;
  const city = asString(raw['city']);
  const country = isRecord(raw['country']) ? asString(raw['country']['name']) : asString(raw['country']);
  const parts: string[] = [];
  if (city !== undefined && city.length > 0) parts.push(city);
  if (country !== undefined && country.length > 0) parts.push(country);
  return parts.join(', ');
}

function buildUrl(slug: string, id: string, raw: Record<string, unknown>): string {
  const direct = asString(raw['application_url']) ?? asString(raw['url']);
  if (direct !== undefined) return direct;
  return `https://${encodeURIComponent(slug)}.breezy.hr/p/${encodeURIComponent(id)}`;
}

function parsePosting(slug: string, raw: unknown): BreezyPosting | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']) ?? asString(raw['_id']);
  const title = asString(raw['name']) ?? asString(raw['title']);
  if (id === undefined || title === undefined) return undefined;
  const descRaw = asString(raw['description']) ?? '';
  const reqRaw = asString(raw['requirements']) ?? '';
  const description = stripHtml([descRaw, reqRaw].filter((s) => s.length > 0).join('\n\n'));
  const location = buildLocation(raw['location']);
  const locObj = isRecord(raw['location']) ? raw['location'] : undefined;
  const remote = detectRemoteSignal(locObj, raw['type'], `${title} ${location} ${description}`);
  const publishedAt = asString(raw['published_date']) ?? asString(raw['updated_date']) ?? asString(raw['creation_date']) ?? asString(raw['published_at']) ?? asString(raw['created_at']);
  const url = buildUrl(slug, id, raw);
  return {
    id,
    title,
    url,
    description,
    location,
    remote,
    publishedAt,
  };
}

function normalize(slug: string, p: BreezyPosting): NormalizedJob {
  const norm: NormalizedJob = {
    id: `breezy:${p.id}`,
    source: 'breezy',
    url: p.url,
    title: p.title,
    company: slug,
    location: p.location,
    remote: p.remote,
    description: p.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(p.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string, http?: SharedHttpOptions): Promise<unknown[]> {
  const url = `https://${encodeURIComponent(slug)}.breezy.hr/json`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { redirect: 'manual', ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `breezy network error: ${msg}`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new SourceFetchError('not_found', `breezy: redirect ${response.status} — likely invalid slug`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `breezy HTTP ${response.status}`);
  }
  const text = response.bodyText;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('[')) {
    throw new SourceFetchError('not_found', 'breezy: body did not start with JSON array — likely invalid slug');
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'breezy response was not valid JSON');
  }
  if (!Array.isArray(body)) {
    throw new SourceFetchError('parse', 'breezy response was not an array');
  }
  return body;
}

async function fetchAndCollect(
  slug: string,
  out: NormalizedJob[],
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<void> {
  const postings = await fetchBoard(slug, http);
  for (const raw of postings) {
    const parsed = parsePosting(slug, raw);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
}

export const breezy: SourceAdapter = {
  name: 'breezy',
  enabled: (config): boolean => {
    const c = config.sources.breezy;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.breezy;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'breezy config missing');
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
        log('warn', 'breezy fetch failed', {
          slug,
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'breezy: all tokens failed');
    }
    return all;
  },
};
