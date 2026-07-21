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

const MAX_CONCURRENT = 2;
const THROTTLE_MS = 1000;

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

function detectWorkableRemote(telecommuting: boolean | undefined, text: string): RemoteMode {
  if (telecommuting === true) return 'remote';
  return detectRemoteFromText(text);
}

interface WorkableJob {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly description: string;
  readonly telecommuting: boolean | undefined;
  readonly createdAt: string | undefined;
}

function buildLocation(raw: Record<string, unknown>): string {
  const city = asString(raw['city']);
  const country = asString(raw['country']) ?? asString(raw['country_code']);
  const fallback = asString(raw['location']);
  const parts: string[] = [];
  if (city !== undefined && city.length > 0) parts.push(city);
  if (country !== undefined && country.length > 0) parts.push(country);
  if (parts.length > 0) return parts.join(', ');
  return fallback ?? '';
}

function parseWorkableJob(raw: unknown): WorkableJob | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']) ?? asString(raw['shortcode']);
  const title = asString(raw['title']);
  if (id === undefined || title === undefined) return undefined;
  const description = stripHtml(asString(raw['description']) ?? '');
  const location = buildLocation(raw);
  const tc = raw['telecommuting'];
  const telecommuting = typeof tc === 'boolean' ? tc : undefined;
  const createdAt = asString(raw['created_at']) ?? asString(raw['published_at']) ?? asString(raw['published_on']);
  return { id, title, location, description, telecommuting, createdAt };
}

function normalize(slug: string, company: string, job: WorkableJob): NormalizedJob {
  const remote = detectWorkableRemote(job.telecommuting, `${job.title} ${job.location} ${job.description}`);
  const norm: NormalizedJob = {
    id: `workable:${job.id}`,
    source: 'workable',
    url: `https://apply.workable.com/${encodeURIComponent(slug)}/j/${encodeURIComponent(job.id)}/`,
    title: job.title,
    company,
    location: job.location,
    remote,
    description: job.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(job.createdAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchAccount(slug: string, http?: SharedHttpOptions): Promise<unknown> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `workable network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `workable HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'workable response was not valid JSON');
  }
}

async function fetchAndCollect(
  slug: string,
  out: NormalizedJob[],
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<void> {
  const body = await fetchAccount(slug, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'workable response was not an object');
  }
  const accountName = asString(body['name']);
  if (accountName === undefined) {
    throw new SourceFetchError('parse', 'workable response missing name');
  }
  const slugNorm = normalizeForCompare(slug);
  const nameNorm = normalizeForCompare(accountName);
  // Workable returns 200 with a placeholder name (e.g. "GlobalVision International") for some invalid slugs; substring-match either direction or drop.
  if (slugNorm.length === 0 || nameNorm.length === 0
      || (!nameNorm.includes(slugNorm) && !slugNorm.includes(nameNorm))) {
    log('warn', 'workable name mismatch (likely placeholder)', { slug, accountName });
    return;
  }
  const jobs = body['jobs'];
  if (!Array.isArray(jobs)) return;
  for (const raw of jobs) {
    const parsed = parseWorkableJob(raw);
    if (parsed === undefined) continue;
    const job = normalize(slug, accountName, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
}

export const workable: SourceAdapter = {
  name: 'workable',
  enabled: (config): boolean => {
    const c = config.sources.workable;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.workable;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'workable config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const tasks = c.tokens.map((slug) => async (): Promise<{ slug: string; jobs: NormalizedJob[] }> => {
      const local: NormalizedJob[] = [];
      await fetchAndCollect(slug, local, accept, http);
      return { slug, jobs: local };
    });
    const results = await runWithConcurrency(tasks, { limit: MAX_CONCURRENT, throttleMs: THROTTLE_MS });
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
        log('warn', 'workable fetch failed', {
          slug,
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'workable: all tokens failed');
    }
    return all;
  },
};
