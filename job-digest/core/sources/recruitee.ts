import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { SourceAdapter } from '../types/source.js';
import {
  SourceFetchError,
  asIsoString,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
} from './_shared.js';

export { SourceFetchError };

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

interface RecruiteeOffer {
  readonly id: number;
  readonly title: string;
  readonly careersUrl: string;
  readonly description: string;
  readonly requirements: string;
  readonly location: string;
  readonly publishedAt: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

function buildLocation(raw: Record<string, unknown>): string {
  const city = asString(raw['city']);
  const country = asString(raw['country_code']);
  const parts: string[] = [];
  if (city !== undefined && city.length > 0) parts.push(city);
  if (country !== undefined && country.length > 0) parts.push(country);
  return parts.join(', ');
}

function parseSalary(s: unknown): { min?: number; max?: number; currency?: string } {
  if (!isRecord(s)) return {};
  const min = asNumber(s['min']);
  const max = asNumber(s['max']);
  const currency = asString(s['currency']);
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}

function parseRecruiteeOffer(raw: unknown): RecruiteeOffer | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asNumber(raw['id']);
  const title = asString(raw['title']);
  const careersUrl = asString(raw['careers_url']);
  if (id === undefined || title === undefined || careersUrl === undefined) return undefined;
  const status = asString(raw['status']);
  if (status !== undefined && status !== 'published') return undefined;
  const description = stripHtml(asString(raw['description']) ?? '');
  const requirements = stripHtml(asString(raw['requirements']) ?? '');
  const location = buildLocation(raw);
  const publishedAt = asString(raw['published_at']) ?? asString(raw['created_at']);
  const salary = parseSalary(raw['salary']);
  return {
    id,
    title,
    careersUrl,
    description,
    requirements,
    location,
    publishedAt,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
  };
}

function normalize(slug: string, offer: RecruiteeOffer, raw: unknown): NormalizedJob {
  const combined = offer.requirements.length > 0
    ? `${offer.description}\n\n${offer.requirements}`
    : offer.description;
  const remote = detectRemoteMode(`${offer.title} ${offer.location} ${combined}`);
  const norm: NormalizedJob = {
    id: `recruitee:${String(offer.id)}`,
    source: 'recruitee',
    url: offer.careersUrl,
    title: offer.title,
    company: slug,
    location: offer.location,
    remote,
    description: combined,
    rawSourceData: raw,
    ...(offer.salaryMin !== undefined ? { salaryMin: offer.salaryMin } : {}),
    ...(offer.salaryMax !== undefined ? { salaryMax: offer.salaryMax } : {}),
    ...(offer.salaryCurrency !== undefined ? { salaryCurrency: offer.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(offer.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string): Promise<unknown> {
  const url = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `recruitee network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `recruitee HTTP ${response.status}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'recruitee response was not valid JSON');
  }
}

async function fetchAndCollect(slug: string, out: NormalizedJob[]): Promise<void> {
  const body = await fetchBoard(slug);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'recruitee response was not an object');
  }
  const offers = body['offers'];
  if (!Array.isArray(offers)) {
    throw new SourceFetchError('parse', 'recruitee response.offers was not an array');
  }
  for (const rawOffer of offers) {
    const parsed = parseRecruiteeOffer(rawOffer);
    if (parsed === undefined) continue;
    out.push(normalize(slug, parsed, rawOffer));
  }
}

export const recruitee: SourceAdapter = {
  name: 'recruitee',
  enabled: (config): boolean => {
    const c = config.sources.recruitee;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.recruitee;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'recruitee config missing');
    }
    const all: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: unknown;
    for (const slug of c.tokens) {
      attempts += 1;
      try {
        await fetchAndCollect(slug, all);
      } catch (err: unknown) {
        failures += 1;
        lastError = err;
        log('warn', 'recruitee fetch failed', { slug, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'recruitee: all slugs failed');
    }
    return all;
  },
};
