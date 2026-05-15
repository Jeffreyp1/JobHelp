import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { SourceAdapter } from '../types/source.js';
import {
  SourceFetchError,
  asNumber,
  asString,
  classifyHttpStatus,
  isRecord,
} from './_shared.js';

export { SourceFetchError };

const REMOTEOK_BASE = 'https://remoteok.com/api';

interface RemoteOkJob {
  readonly id: string;
  readonly url: string;
  readonly company: string;
  readonly position: string;
  readonly description: string;
  readonly location: string;
  readonly postedEpoch: number | undefined;
  readonly salaryMin: number | undefined;
  readonly salaryMax: number | undefined;
  readonly applyUrl: string | undefined;
}

function parseRemoteOkJob(raw: unknown): RemoteOkJob | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw['id']);
  const url = asString(raw['url']);
  const company = asString(raw['company']);
  const position = asString(raw['position']);
  if (id === undefined || url === undefined || company === undefined || position === undefined) return undefined;
  const applyUrl = asString(raw['apply_url']);
  return {
    id,
    url,
    company,
    position,
    description: asString(raw['description']) ?? '',
    location: asString(raw['location']) ?? '',
    postedEpoch: asNumber(raw['epoch']),
    salaryMin: asNumber(raw['salary_min']),
    salaryMax: asNumber(raw['salary_max']),
    applyUrl: applyUrl !== undefined && applyUrl.length > 0 ? applyUrl : undefined,
  };
}

function epochToIso(epoch: number | undefined): string | undefined {
  if (epoch === undefined) return undefined;
  const d = new Date(epoch * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function normalize(job: RemoteOkJob, raw: unknown): NormalizedJob {
  const norm: NormalizedJob = {
    id: `remoteok:${job.id}`,
    source: 'remoteok',
    url: job.applyUrl ?? job.url,
    title: job.position,
    company: job.company,
    location: job.location,
    remote: 'remote',
    description: job.description,
    rawSourceData: raw,
    ...(job.salaryMin !== undefined ? { salaryMin: job.salaryMin } : {}),
    ...(job.salaryMax !== undefined ? { salaryMax: job.salaryMax } : {}),
    ...((): { postedAt: string } | object => {
      const iso = epochToIso(job.postedEpoch);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

function buildUrl(tags: readonly string[] | undefined): string {
  if (tags !== undefined && tags.length > 0) {
    const params = new URLSearchParams({ tags: tags.join(',') });
    return `${REMOTEOK_BASE}?${params.toString()}`;
  }
  return REMOTEOK_BASE;
}

async function fetchFeed(tags: readonly string[] | undefined): Promise<NormalizedJob[]> {
  const url = buildUrl(tags);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'JobHelp/1.0 (+https://github.com/Jeffreyp1/JobHelp)' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `remoteok network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `remoteok HTTP ${response.status}`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'read failed';
    throw new SourceFetchError('network', `remoteok body read error: ${msg}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new SourceFetchError('parse', 'remoteok response was not valid JSON');
  }
  if (!Array.isArray(body)) {
    throw new SourceFetchError('parse', 'remoteok response was not an array');
  }
  const out: NormalizedJob[] = [];
  for (let i = 1; i < body.length; i++) {
    const rawJob = body[i];
    const parsed = parseRemoteOkJob(rawJob);
    if (parsed === undefined) continue;
    out.push(normalize(parsed, rawJob));
  }
  return out;
}

export const remoteok: SourceAdapter = {
  name: 'remoteok',
  enabled: (config): boolean => Boolean(config.sources.remoteok),
  fetch: async (config): Promise<readonly NormalizedJob[]> => {
    const cfg = config.sources.remoteok;
    if (!cfg) return [];
    const tagSets: Array<readonly string[] | undefined> =
      cfg.tags !== undefined && cfg.tags.length > 0 ? [cfg.tags] : [undefined];
    const pool: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: SourceFetchError | undefined;
    for (const tags of tagSets) {
      attempts += 1;
      try {
        const jobs = await fetchFeed(tags);
        pool.push(...jobs);
      } catch (err: unknown) {
        failures += 1;
        if (err instanceof SourceFetchError) lastError = err;
        log('warn', 'remoteok: fetch failed', {
          tags: tags !== undefined ? tags.join(',') : '<all>',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (failures === attempts && lastError !== undefined) throw lastError;
    return pool;
  },
};
