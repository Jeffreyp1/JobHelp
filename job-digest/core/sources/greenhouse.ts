import { log } from '../lib/log.js';
import type { JobDigestConfig } from '../types/config.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { SourceAdapter, SourceErrorType } from '../types/source.js';

/** Typed transport error every source adapter raises. */
export class SourceFetchError extends Error {
  readonly type: SourceErrorType;
  constructor(type: SourceErrorType, message: string) {
    super(message);
    this.name = 'SourceFetchError';
    this.type = type;
  }
}

function classifyHttpStatus(status: number): SourceErrorType {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 400) return 'network';
  return 'unknown';
}

function detectRemoteMode(text: string): RemoteMode {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(remote|wfh|work[- ]from[- ]home)\b/.test(t)) return 'remote';
  if (/\b(on[- ]?site|in[- ]office)\b/.test(t)) return 'onsite';
  return 'unknown';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asIsoString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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
interface GreenhouseJob {
  readonly id: number;
  readonly title: string;
  readonly absoluteUrl: string;
  readonly contentHtml: string;
  readonly location: string;
  readonly updatedAt: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

function parseMetadata(meta: unknown): { min?: number; max?: number; currency?: string } {
  if (!Array.isArray(meta)) return {};
  const out: { min?: number; max?: number; currency?: string } = {};
  for (const entry of meta) {
    if (!isRecord(entry)) continue;
    const name = asString(entry['name']);
    const value = entry['value'];
    if (name === 'salary_min') {
      const n = asNumber(value);
      if (n !== undefined) out.min = n;
    } else if (name === 'salary_max') {
      const n = asNumber(value);
      if (n !== undefined) out.max = n;
    } else if (name === 'salary_currency') {
      const s = asString(value);
      if (s !== undefined) out.currency = s;
    }
  }
  return out;
}

function parseGreenhouseJob(raw: unknown): GreenhouseJob | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asNumber(raw['id']);
  const title = asString(raw['title']);
  const absoluteUrl = asString(raw['absolute_url']);
  if (id === undefined || title === undefined || absoluteUrl === undefined) return undefined;
  const contentHtml = asString(raw['content']) ?? '';
  const locObj = raw['location'];
  const location = isRecord(locObj) ? asString(locObj['name']) ?? '' : '';
  const updatedAt = asString(raw['updated_at']);
  const salary = parseMetadata(raw['metadata']);
  return {
    id,
    title,
    absoluteUrl,
    contentHtml,
    location,
    updatedAt,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
  };
}
function normalize(token: string, job: GreenhouseJob, raw: unknown): NormalizedJob {
  const description = stripHtml(job.contentHtml);
  const remoteText = `${job.title} ${job.location} ${description}`;
  const remote = detectRemoteMode(remoteText);
  const norm: NormalizedJob = {
    id: `greenhouse:${String(job.id)}`,
    source: 'greenhouse',
    url: job.absoluteUrl,
    title: job.title,
    company: token,
    location: job.location,
    remote,
    description,
    rawSourceData: raw,
    ...(job.salaryMin !== undefined ? { salaryMin: job.salaryMin } : {}),
    ...(job.salaryMax !== undefined ? { salaryMax: job.salaryMax } : {}),
    ...(job.salaryCurrency !== undefined ? { salaryCurrency: job.salaryCurrency } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(job.updatedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(token: string): Promise<unknown> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `greenhouse network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `greenhouse HTTP ${response.status}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'greenhouse response was not valid JSON');
  }
}
export const greenhouse: SourceAdapter = {
  name: 'greenhouse',
  enabled: (config): boolean => {
    const c = config.sources.greenhouse;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.greenhouse;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'greenhouse config missing');
    }
    const all: NormalizedJob[] = [];
    for (const token of c.tokens) {
      let body: unknown;
      try {
        body = await fetchBoard(token);
      } catch (err: unknown) {
        log('warn', 'greenhouse fetch failed', { token, error: err instanceof Error ? err.message : 'unknown' });
        throw err;
      }
      if (!isRecord(body)) {
        throw new SourceFetchError('parse', 'greenhouse response was not an object');
      }
      const jobs = body['jobs'];
      if (!Array.isArray(jobs)) {
        throw new SourceFetchError('parse', 'greenhouse response.jobs was not an array');
      }
      for (const rawJob of jobs) {
        const parsed = parseGreenhouseJob(rawJob);
        if (parsed === undefined) continue;
        all.push(normalize(token, parsed, rawJob));
      }
    }
    return all;
  },
};
