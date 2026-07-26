import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asNumber,
  asString,
  classifyHttpStatus,
  detectRemoteMode,
  isRecord,
  runWithConcurrency,
} from './_shared.js';

export { SourceFetchError };

const YC_CONCURRENCY = 5;
const YC_BASE = 'https://www.workatastartup.com';
const DEFAULT_QUERY = 'software engineer';

// The WaaS job board exposes a public, key-less JSON route (/jobs/search?q=)
// that wraps its Algolia index server-side; raw curl gets 406, so a
// browser-like User-Agent + Accept header is required. The route shape was
// read off the JobsPage client bundle and may change if the SPA is rebuilt.
const YC_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

interface YcJob {
  readonly id: number;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly jobType: string;
  readonly roleType: string;
  readonly companyOneLiner: string;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly salaryCurrency: string | undefined;
}

const MAGNITUDE: Readonly<Record<string, number>> = { k: 1e3, m: 1e6 };

const SYMBOL_CURRENCY: Readonly<Record<string, string>> = {
  $: 'USD',
  '₹': 'INR',
  '€': 'EUR',
  '£': 'GBP',
};

function parseAmount(raw: string): number | undefined {
  const m = /([\d.]+)\s*([km])?/i.exec(raw);
  if (m === null) return undefined;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = m[2]?.toLowerCase();
  const scale = suffix !== undefined ? MAGNITUDE[suffix] ?? 1 : 1;
  return base * scale;
}

// Salary arrives as a display string: "$150K - $220K", "$115K - $175K CAD",
// "₹2M - ₹4M INR", or null.
function parseSalary(value: unknown): {
  min?: number;
  max?: number;
  currency?: string;
} {
  const s = asString(value);
  if (s === undefined || s.trim() === '') return {};
  const parts = s.split(/[-–—]/);
  const min = parts[0] !== undefined ? parseAmount(parts[0]) : undefined;
  const max = parts[1] !== undefined ? parseAmount(parts[1]) : undefined;
  const explicit = /\b([A-Z]{3})\b/.exec(s);
  let currency = explicit !== null ? explicit[1] : undefined;
  if (currency === undefined) {
    for (const [sym, code] of Object.entries(SYMBOL_CURRENCY)) {
      if (s.includes(sym)) {
        currency = code;
        break;
      }
    }
  }
  const out: { min?: number; max?: number; currency?: string } = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  if (currency !== undefined && (min !== undefined || max !== undefined)) {
    out.currency = currency;
  }
  return out;
}

function parseYcJob(raw: unknown): YcJob | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asNumber(raw['id']);
  const title = asString(raw['title']);
  if (id === undefined || title === undefined) return undefined;
  const salary = parseSalary(raw['salary']);
  return {
    id,
    title,
    company: asString(raw['companyName']) ?? 'Unknown',
    location: asString(raw['location']) ?? '',
    jobType: asString(raw['jobType']) ?? '',
    roleType: asString(raw['roleType']) ?? '',
    companyOneLiner: asString(raw['companyOneLiner']) ?? '',
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
  };
}

function buildDescription(job: YcJob): string {
  const lines: string[] = [];
  if (job.roleType !== '') lines.push(`Role type: ${job.roleType}`);
  if (job.jobType !== '') lines.push(`Job type: ${job.jobType}`);
  if (job.companyOneLiner !== '') lines.push(job.companyOneLiner);
  return lines.join('\n');
}

function normalize(job: YcJob): NormalizedJob {
  const description = buildDescription(job);
  const remote = detectRemoteMode(`${job.title} ${job.location} ${description}`);
  const norm: NormalizedJob = {
    id: `yc:${String(job.id)}`,
    source: 'yc',
    url: `${YC_BASE}/jobs/${String(job.id)}`,
    title: job.title,
    company: job.company,
    location: job.location,
    remote,
    description,
    ...(job.salaryMin !== undefined ? { salaryMin: job.salaryMin } : {}),
    ...(job.salaryMax !== undefined ? { salaryMax: job.salaryMax } : {}),
    ...(job.salaryCurrency !== undefined ? { salaryCurrency: job.salaryCurrency } : {}),
  };
  return norm;
}

async function fetchQuery(query: string, http?: SharedHttpOptions): Promise<unknown> {
  const url = `${YC_BASE}/jobs/search?q=${encodeURIComponent(query)}`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { headers: YC_HEADERS, ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `yc network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `yc HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'yc response was not valid JSON');
  }
}

async function fetchQueryJobs(
  query: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const body = await fetchQuery(query, http);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'yc response was not an object');
  }
  const jobs = body['jobs'];
  if (!Array.isArray(jobs)) {
    throw new SourceFetchError('parse', 'yc response.jobs was not an array');
  }
  const out: NormalizedJob[] = [];
  for (const rawJob of jobs) {
    const parsed = parseYcJob(rawJob);
    if (parsed === undefined) continue;
    const job = normalize(parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const yc: SourceAdapter = {
  name: 'yc',
  enabled: (config): boolean => Boolean(config.sources.yc),
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.yc;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'yc config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const queries =
      c.queries !== undefined && c.queries.length > 0 ? c.queries : [DEFAULT_QUERY];
    const tasks = queries.map((query) => (): Promise<NormalizedJob[]> => fetchQueryJobs(query, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: YC_CONCURRENCY });
    const byId = new Map<string, NormalizedJob>();
    let lastError: unknown;
    let failures = 0;
    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i];
      if (r === undefined) continue;
      if (r.status === 'fulfilled') {
        for (const job of r.value) byId.set(job.id, job);
      } else {
        failures += 1;
        lastError = r.reason;
        log('warn', 'yc fetch failed', {
          query: queries[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (queries.length > 0 && failures === queries.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'yc: all queries failed');
    }
    return Array.from(byId.values());
  },
};
