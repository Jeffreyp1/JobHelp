import { log } from '../lib/log.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode as detectRemoteFromText,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

// Ashby has no observed rate limit; fetch boards aggressively in parallel.
// No observed rate limit; 50 measured marginally faster than 35 with zero errors (2026-06-12).
const ASHBY_CONCURRENCY = 50;

export { SourceFetchError };

function detectRemoteMode(workplaceType: string | undefined, text: string): RemoteMode {
  if (workplaceType !== undefined) {
    const w = workplaceType.toLowerCase();
    if (w === 'remote') return 'remote';
    if (w === 'hybrid') return 'hybrid';
    if (w === 'inperson' || w === 'in-person' || w === 'onsite' || w === 'on-site') return 'onsite';
  }
  return detectRemoteFromText(text);
}

interface AshbyJob {
  readonly id: string;
  readonly title: string;
  readonly jobUrl: string;
  readonly description: string;
  readonly location: string;
  readonly workplaceType: string | undefined;
  readonly publishedAt: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

// First-match-wins across regional tiers: surfaces *a* salary signal for ranking rather than
// guessing which regional tier is canonical for the candidate.
function parseCompensation(comp: unknown): { min?: number; max?: number; currency?: string } {
  if (!isRecord(comp)) return {};
  const tiers = comp['compensationTiers'];
  if (!Array.isArray(tiers)) return {};
  for (const tier of tiers) {
    if (!isRecord(tier)) continue;
    const components = tier['components'];
    if (!Array.isArray(components)) continue;
    for (const c of components) {
      if (!isRecord(c)) continue;
      const min = asNumber(c['minValue']);
      const max = asNumber(c['maxValue']);
      const currency = asString(c['currencyCode']);
      if (min !== undefined || max !== undefined) {
        return {
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
          ...(currency !== undefined ? { currency } : {}),
        };
      }
    }
  }
  return {};
}

function parseAshbyJob(raw: unknown): AshbyJob | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']);
  const title = asString(raw['title']);
  const jobUrl = asString(raw['jobUrl']);
  if (id === undefined || title === undefined || jobUrl === undefined) return undefined;
  const description = asString(raw['descriptionPlain']) ?? '';
  const location = asString(raw['location']) ?? '';
  const workplaceType = asString(raw['workplaceType']);
  const publishedAt = asString(raw['publishedAt']);
  const salary = parseCompensation(raw['compensation']);
  return {
    id,
    title,
    jobUrl,
    description,
    location,
    workplaceType,
    publishedAt,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
  };
}

function normalize(token: string, job: AshbyJob): NormalizedJob {
  const remote = detectRemoteMode(job.workplaceType, `${job.title} ${job.location} ${job.description}`);
  const norm: NormalizedJob = {
    id: `ashby:${job.id}`,
    source: 'ashby',
    url: job.jobUrl,
    title: job.title,
    company: token,
    location: job.location,
    remote,
    description: job.description,
    ...(job.salaryMin !== undefined ? { salaryMin: job.salaryMin } : {}),
    ...(job.salaryMax !== undefined ? { salaryMax: job.salaryMax } : {}),
    ...(job.salaryCurrency !== undefined ? { salaryCurrency: job.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(job.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(token: string, http?: SharedHttpOptions): Promise<unknown> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `ashby network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `ashby HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'ashby response was not valid JSON');
  }
}

async function fetchTokenJobs(
  token: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const body = await fetchBoard(token, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'ashby response was not an object');
  }
  const jobs = body['jobs'];
  if (!Array.isArray(jobs)) {
    throw new SourceFetchError('parse', 'ashby response.jobs was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawJob of jobs) {
    const parsed = parseAshbyJob(rawJob);
    if (parsed === undefined) continue;
    const job = normalize(token, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const ashby: SourceAdapter = {
  name: 'ashby',
  enabled: (config): boolean => {
    const c = config.sources.ashby;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.ashby;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'ashby config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const tokens = c.tokens;
    const tasks = tokens.map((token) => (): Promise<NormalizedJob[]> => fetchTokenJobs(token, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: ASHBY_CONCURRENCY });
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
        log('warn', 'ashby fetch failed', {
          token: tokens[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (tokens.length > 0 && failures === tokens.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'ashby: all tokens failed');
    }
    return all;
  },
};
