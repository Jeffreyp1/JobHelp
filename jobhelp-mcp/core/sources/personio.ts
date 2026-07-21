import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  classifyHttpStatus,
  detectRemoteMode,
  runWithConcurrency,
} from './_shared.js';

// Each slug is its own *.jobs.personio.de tenant, so cross-slug parallelism is rate-limit safe.
const PERSONIO_CONCURRENCY = 25;

export { SourceFetchError };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    });
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s: string): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTagText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  if (m === null || m[1] === undefined) return undefined;
  return decodeEntities(stripCdata(m[1])).trim();
}

function extractAllTags(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    if (m[1] !== undefined) out.push(decodeEntities(stripCdata(m[1])).trim());
  }
  return out;
}

interface PersonioPosition {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly location: string;
  readonly publishedAt: string | undefined;
}

function parsePositionBlock(slug: string, block: string): PersonioPosition | undefined {
  const idRaw = extractTagText(block, 'id');
  const title = extractTagText(block, 'name');
  if (idRaw === undefined || title === undefined) return undefined;
  const office = extractTagText(block, 'office') ?? '';
  const department = extractTagText(block, 'department') ?? '';
  const location = office.length > 0 ? office : department;
  const publishedAt = extractTagText(block, 'createdAt') ?? extractTagText(block, 'created_at');
  const descParts: string[] = [];
  const jobDescriptions = extractTagText(block, 'jobDescriptions');
  if (jobDescriptions !== undefined) {
    for (const inner of extractAllTags(jobDescriptions, 'jobDescription')) {
      const name = extractTagText(inner, 'name') ?? '';
      const value = extractTagText(inner, 'value') ?? '';
      if (name.length > 0) descParts.push(`## ${name}`);
      if (value.length > 0) descParts.push(stripHtml(value));
    }
  }
  const description = descParts.join('\n\n').trim();
  const url = `https://${slug}.jobs.personio.de/job/${idRaw}`;
  return {
    id: idRaw,
    title,
    url,
    description,
    location,
    publishedAt,
  };
}

function normalize(slug: string, p: PersonioPosition): NormalizedJob {
  const remote = detectRemoteMode(`${p.title} ${p.location} ${p.description}`);
  const norm: NormalizedJob = {
    id: `personio:${p.id}`,
    source: 'personio',
    url: p.url,
    title: p.title,
    company: slug,
    location: p.location,
    remote,
    description: p.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(p.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string, http?: SharedHttpOptions): Promise<string> {
  const url = `https://${encodeURIComponent(slug)}.jobs.personio.de/xml`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { redirect: 'manual', headers: { Accept: 'application/xml' }, ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `personio network error: ${msg}`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new SourceFetchError('not_found', `personio: redirect ${response.status} — likely invalid slug`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `personio HTTP ${response.status}`);
  }
  const text = response.bodyText;
  if (!/<workzag-jobs\b/i.test(text) && !/<position\b/i.test(text)) {
    throw new SourceFetchError('parse', 'personio: response missing <workzag-jobs> and <position> tags');
  }
  return text;
}

async function fetchSlugJobs(
  slug: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const xml = await fetchBoard(slug, http);
  const positions = extractAllTags(xml, 'position');
  const out: NormalizedJob[] = [];
  for (const block of positions) {
    const parsed = parsePositionBlock(slug, block);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const personio: SourceAdapter = {
  name: 'personio',
  enabled: (config): boolean => {
    const c = config.sources.personio;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.personio;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'personio config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const tokens = c.tokens;
    const tasks = tokens.map((slug) => (): Promise<NormalizedJob[]> => fetchSlugJobs(slug, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: PERSONIO_CONCURRENCY });
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
        log('warn', 'personio fetch failed', {
          slug: tokens[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (tokens.length > 0 && failures === tokens.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'personio: all tokens failed');
    }
    return all;
  },
};
