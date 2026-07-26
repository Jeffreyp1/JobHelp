import { log } from '../lib/log.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode as detectRemoteFromText,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

// Shared api.lever.co host: moderate ceiling, unlike the per-tenant-subdomain sources.
const LEVER_CONCURRENCY = 15;

export { SourceFetchError };

function detectRemoteMode(text: string, workplaceType: string | undefined): RemoteMode {
  if (workplaceType !== undefined) {
    const w = workplaceType.toLowerCase();
    if (w === 'remote') return 'remote';
    if (w === 'hybrid') return 'hybrid';
    if (w === 'on-site' || w === 'onsite') return 'onsite';
  }
  return detectRemoteFromText(text);
}

function epochMsToIso(v: unknown): string | undefined {
  const n = asNumber(v);
  if (n === undefined) return undefined;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

interface LeverPosting {
  readonly id: string;
  readonly title: string;
  readonly hostedUrl: string;
  readonly description: string;
  readonly location: string;
  readonly createdAtMs: number | undefined;
  readonly workplaceType: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

function parseLeverPosting(raw: unknown): LeverPosting | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']);
  const title = asString(raw['text']);
  const hostedUrl = asString(raw['hostedUrl']);
  if (id === undefined || title === undefined || hostedUrl === undefined) return undefined;
  const description = asString(raw['descriptionPlain']) ?? asString(raw['description']) ?? '';
  const categories = raw['categories'];
  const location = isRecord(categories) ? asString(categories['location']) ?? '' : '';
  const createdAtMs = asNumber(raw['createdAt']);
  const workplaceType = asString(raw['workplaceType']);
  const salaryRange = raw['salaryRange'];
  let salaryMin: number | undefined;
  let salaryMax: number | undefined;
  let salaryCurrency: string | undefined;
  if (isRecord(salaryRange)) {
    salaryMin = asNumber(salaryRange['min']);
    salaryMax = asNumber(salaryRange['max']);
    salaryCurrency = asString(salaryRange['currency']);
  }
  return {
    id,
    title,
    hostedUrl,
    description,
    location,
    createdAtMs,
    workplaceType,
    salaryMin,
    salaryMax,
    salaryCurrency,
  };
}

function normalize(slug: string, p: LeverPosting): NormalizedJob {
  const remote = detectRemoteMode(`${p.title} ${p.location} ${p.description}`, p.workplaceType);
  const norm: NormalizedJob = {
    id: `lever:${p.id}`,
    source: 'lever',
    url: p.hostedUrl,
    title: p.title,
    company: slug,
    location: p.location,
    remote,
    description: p.description,
    ...(p.salaryMin !== undefined ? { salaryMin: p.salaryMin } : {}),
    ...(p.salaryMax !== undefined ? { salaryMax: p.salaryMax } : {}),
    ...(p.salaryCurrency !== undefined ? { salaryCurrency: p.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = epochMsToIso(p.createdAtMs);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchPostings(slug: string, http?: SharedHttpOptions): Promise<unknown> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `lever network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `lever HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'lever response was not valid JSON');
  }
}

async function fetchSlugJobs(
  slug: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const body = await fetchPostings(slug, http);
  if (!Array.isArray(body)) {
    throw new SourceFetchError('parse', 'lever response was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawPosting of body) {
    const parsed = parseLeverPosting(rawPosting);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const lever: SourceAdapter = {
  name: 'lever',
  enabled: (config): boolean => {
    const c = config.sources.lever;
    return c !== undefined && c.slugs.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.lever;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'lever config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const slugs = c.slugs;
    const tasks = slugs.map((slug) => (): Promise<NormalizedJob[]> => fetchSlugJobs(slug, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: LEVER_CONCURRENCY });
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
        log('warn', 'lever fetch failed', {
          slug: slugs[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (slugs.length > 0 && failures === slugs.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'lever: all slugs failed');
    }
    return all;
  },
};
