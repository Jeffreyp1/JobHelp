import { log } from '../lib/log.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { SourceAdapter } from '../types/source.js';
import {
  SourceFetchError,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode as detectRemoteFromText,
  isRecord,
} from './_shared.js';

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

function normalize(slug: string, p: LeverPosting, raw: unknown): NormalizedJob {
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
    rawSourceData: raw,
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

async function fetchPostings(slug: string): Promise<unknown> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `lever network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `lever HTTP ${response.status}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'lever response was not valid JSON');
  }
}

async function fetchAndCollect(slug: string, out: NormalizedJob[]): Promise<void> {
  const body = await fetchPostings(slug);
  if (!Array.isArray(body)) {
    throw new SourceFetchError('parse', 'lever response was not an array');
  }
  for (const rawPosting of body) {
    const parsed = parseLeverPosting(rawPosting);
    if (parsed === undefined) continue;
    out.push(normalize(slug, parsed, rawPosting));
  }
}

export const lever: SourceAdapter = {
  name: 'lever',
  enabled: (config): boolean => {
    const c = config.sources.lever;
    return c !== undefined && c.slugs.length > 0;
  },
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.lever;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'lever config missing');
    }
    const all: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: unknown;
    for (const slug of c.slugs) {
      attempts += 1;
      try {
        await fetchAndCollect(slug, all);
      } catch (err: unknown) {
        failures += 1;
        lastError = err;
        log('warn', 'lever fetch failed', { slug, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'lever: all slugs failed');
    }
    return all;
  },
};
