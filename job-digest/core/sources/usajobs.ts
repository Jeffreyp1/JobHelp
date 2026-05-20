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
  runWithConcurrency,
} from './_shared.js';

export { SourceFetchError };

// USAJobs enforces light per-IP rate limits; modest fan-out is plenty.
const USAJOBS_CONCURRENCY = 5;
const USAJOBS_RESULTS_PER_PAGE = 500;
// Bound per-query runtime; public keys page in 25s, agency keys in 500s.
const USAJOBS_MAX_PAGES = 10;

interface UsaJobsPosition {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly company: string;
  readonly location: string;
  readonly description: string;
  readonly postedAt: string | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
}

function firstArrayString(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined;
  for (const entry of v) {
    const s = asString(entry);
    if (s !== undefined && s.length > 0) return s;
  }
  return undefined;
}

function parseSalary(remuneration: unknown): { min?: number; max?: number } {
  if (!Array.isArray(remuneration) || remuneration.length === 0) return {};
  const first = remuneration[0];
  if (!isRecord(first)) return {};
  const out: { min?: number; max?: number } = {};
  const min = asNumber(first['MinimumRange']);
  const max = asNumber(first['MaximumRange']);
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}

function parsePosition(raw: unknown): UsaJobsPosition | undefined {
  if (!isRecord(raw)) return undefined;
  const descriptor = raw['MatchedObjectDescriptor'];
  if (!isRecord(descriptor)) return undefined;
  const title = asString(descriptor['PositionTitle']);
  if (title === undefined) return undefined;
  const url = asString(descriptor['PositionURI']) ?? firstArrayString(descriptor['ApplyURI']);
  if (url === undefined) return undefined;
  const id =
    asString(raw['MatchedObjectId']) ?? asString(descriptor['PositionID']);
  if (id === undefined) return undefined;
  const locArr = descriptor['PositionLocation'];
  let location = '';
  if (Array.isArray(locArr) && locArr.length > 0 && isRecord(locArr[0])) {
    location = asString(locArr[0]['LocationName']) ?? '';
  }
  const company =
    asString(descriptor['OrganizationName']) ??
    asString(descriptor['DepartmentName']) ??
    'Unknown';
  let description = '';
  const userArea = descriptor['UserArea'];
  if (isRecord(userArea)) {
    const details = userArea['Details'];
    if (isRecord(details)) description = asString(details['JobSummary']) ?? '';
  }
  const salary = parseSalary(descriptor['PositionRemuneration']);
  return {
    id,
    title,
    url,
    company,
    location,
    description,
    postedAt: asString(descriptor['PublicationStartDate']),
    salaryMin: salary.min,
    salaryMax: salary.max,
  };
}

function normalize(position: UsaJobsPosition, raw: unknown): NormalizedJob {
  const remoteText = `${position.title} ${position.description} ${position.location}`;
  const remote = detectRemoteMode(remoteText);
  const job: NormalizedJob = {
    id: `usajobs:${position.id}`,
    source: 'usajobs',
    url: position.url,
    title: position.title,
    company: position.company,
    location: position.location,
    remote,
    description: position.description,
    rawSourceData: raw,
    ...(position.salaryMin !== undefined ? { salaryMin: position.salaryMin } : {}),
    ...(position.salaryMax !== undefined ? { salaryMax: position.salaryMax } : {}),
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(position.postedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return job;
}

function buildUrl(query: string | undefined, page: number): string {
  const params = new URLSearchParams({
    ResultsPerPage: String(USAJOBS_RESULTS_PER_PAGE),
    Page: String(page),
  });
  if (query !== undefined && query.length > 0) params.set('Keyword', query);
  return `https://data.usajobs.gov/api/search?${params.toString()}`;
}

async function fetchOnePage(url: string, apiKey: string, email: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Host: 'data.usajobs.gov',
        'User-Agent': email,
        'Authorization-Key': apiKey,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `usajobs network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `usajobs HTTP ${response.status}`);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'read failed';
    throw new SourceFetchError('network', `usajobs body read error: ${msg}`);
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'usajobs response was not valid JSON');
  }
}

interface UsaJobsPage {
  readonly jobs: NormalizedJob[];
  readonly countAll: number;
  readonly countThisPage: number;
}

async function fetchQueryPage(
  query: string | undefined,
  page: number,
  apiKey: string,
  email: string,
): Promise<UsaJobsPage> {
  const body = await fetchOnePage(buildUrl(query, page), apiKey, email);
  if (!isRecord(body)) {
    throw new SourceFetchError('parse', 'usajobs response was not an object');
  }
  const searchResult = body['SearchResult'];
  if (!isRecord(searchResult)) {
    throw new SourceFetchError('parse', 'usajobs response.SearchResult missing');
  }
  const items = searchResult['SearchResultItems'];
  if (!Array.isArray(items)) {
    throw new SourceFetchError('parse', 'usajobs SearchResultItems was not an array');
  }
  const jobs: NormalizedJob[] = [];
  for (const rawItem of items) {
    const parsed = parsePosition(rawItem);
    if (parsed === undefined) continue;
    jobs.push(normalize(parsed, rawItem));
  }
  return {
    jobs,
    countAll: asNumber(searchResult['SearchResultCountAll']) ?? items.length,
    countThisPage: asNumber(searchResult['SearchResultCount']) ?? items.length,
  };
}

async function fetchQueryJobs(
  query: string | undefined,
  apiKey: string,
  email: string,
): Promise<NormalizedJob[]> {
  const first = await fetchQueryPage(query, 1, apiKey, email);
  const out: NormalizedJob[] = [...first.jobs];
  // The public/free key caps a page at 25; loop remaining pages until every
  // result is collected or the page budget is spent.
  const pageSize = first.countThisPage > 0 ? first.countThisPage : USAJOBS_RESULTS_PER_PAGE;
  const totalPages = Math.min(Math.ceil(first.countAll / pageSize), USAJOBS_MAX_PAGES);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchQueryPage(query, page, apiKey, email);
    if (next.jobs.length === 0) break;
    for (const job of next.jobs) out.push(job);
  }
  return out;
}

export const usajobs: SourceAdapter = {
  name: 'usajobs',
  enabled: (config): boolean => {
    const c = config.sources.usajobs;
    return c !== undefined && c.apiKey.length > 0 && c.email.length > 0;
  },
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.usajobs;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'usajobs config missing');
    }
    const queries: ReadonlyArray<string | undefined> =
      c.queries !== undefined && c.queries.length > 0 ? c.queries : [undefined];
    const tasks = queries.map((query) => (): Promise<NormalizedJob[]> =>
      fetchQueryJobs(query, c.apiKey, c.email));
    const settled = await runWithConcurrency(tasks, { limit: USAJOBS_CONCURRENCY });
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
        log('warn', 'usajobs fetch failed', {
          query: queries[i] ?? '(general listing)',
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (queries.length > 0 && failures === queries.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'usajobs: all queries failed');
    }
    return all;
  },
};
