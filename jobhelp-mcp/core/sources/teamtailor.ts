import { log } from '../lib/log.js';
import type { NormalizedJob, RemoteMode } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  classifyHttpStatus,
  detectRemoteMode as detectRemoteFromText,
} from './_shared.js';

export { SourceFetchError };

// Each slug is its own *.teamtailor.com tenant, so cross-slug parallelism is rate-limit safe.
const MAX_IN_FLIGHT = 15;

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

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTag(block: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const m = re.exec(block);
  if (m === null || m[1] === undefined) return undefined;
  return decodeEntities(stripCdata(m[1])).trim();
}

function extractAllItems(xml: string): string[] {
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const out: string[] = [];
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

function extractLocation(block: string): string {
  const locBlock = extractTag(block, 'tt:locations');
  if (locBlock !== undefined) {
    const name = extractTag(locBlock, 'tt:name');
    if (name !== undefined && name.length > 0) return name;
    const city = extractTag(locBlock, 'tt:city') ?? '';
    const country = extractTag(locBlock, 'tt:country') ?? '';
    const joined = [city, country].filter((p) => p.length > 0).join(', ');
    if (joined.length > 0) return joined;
  }
  const category = extractTag(block, 'category');
  return category !== undefined ? category : '';
}

function detectRemote(block: string, text: string): RemoteMode {
  const status = extractTag(block, 'remoteStatus');
  if (status !== undefined) {
    const s = status.toLowerCase();
    if (s === 'fully' || s === 'remote') return 'remote';
    if (s === 'hybrid' || s === 'temporary') return 'hybrid';
    if (s === 'none' || s === 'onsite') return 'onsite';
  }
  return detectRemoteFromText(text);
}

function deriveIdFromLink(link: string): string {
  const m = /\/jobs\/([^/?#]+)/.exec(link);
  return m !== null && m[1] !== undefined ? m[1] : link;
}

interface TeamtailorItem {
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly description: string;
  readonly location: string;
  readonly remote: RemoteMode;
  readonly publishedAt: string | undefined;
}

function parseItem(block: string): TeamtailorItem | undefined {
  const title = extractTag(block, 'title');
  const link = extractTag(block, 'link');
  if (title === undefined || link === undefined) return undefined;
  const rawDescription = extractTag(block, 'description') ?? '';
  const description = stripHtml(rawDescription);
  const guid = extractTag(block, 'guid');
  const id = guid !== undefined && guid.length > 0 ? guid : deriveIdFromLink(link);
  const location = extractLocation(block);
  const remote = detectRemote(block, `${title} ${location} ${description}`);
  const publishedAt = extractTag(block, 'pubDate');
  return { id, title, link, description, location, remote, publishedAt };
}

function normalize(slug: string, item: TeamtailorItem): NormalizedJob {
  const norm: NormalizedJob = {
    id: `teamtailor:${slug}:${item.id}`,
    source: 'teamtailor',
    url: item.link,
    title: item.title,
    company: slug,
    location: item.location,
    remote: item.remote,
    description: item.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(item.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchBoard(slug: string, http?: SharedHttpOptions): Promise<string> {
  const url = `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.rss`;
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `teamtailor network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `teamtailor HTTP ${response.status}`);
  }
  const contentType = response.contentType.toLowerCase();
  const text = response.bodyText;
  if (!contentType.includes('rss') && !contentType.includes('xml') && !/<rss\b/i.test(text)) {
    throw new SourceFetchError('parse', `teamtailor: non-RSS content-type (${contentType})`);
  }
  return text;
}

async function fetchAndCollect(
  slug: string,
  out: NormalizedJob[],
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<void> {
  const xml = await fetchBoard(slug, http);
  for (const block of extractAllItems(xml)) {
    const parsed = parseItem(block);
    if (parsed === undefined) continue;
    const job = normalize(slug, parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const launch = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      const item = items[i];
      if (item === undefined) continue;
      await worker(item);
    }
  };
  const n = Math.min(limit, items.length);
  const runners: Promise<void>[] = [];
  for (let i = 0; i < n; i += 1) runners.push(launch());
  await Promise.all(runners);
}

export const teamtailor: SourceAdapter = {
  name: 'teamtailor',
  enabled: (config): boolean => {
    const c = config.sources.teamtailor;
    return c !== undefined && c.tokens.length > 0;
  },
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.teamtailor;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'teamtailor config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const all: NormalizedJob[] = [];
    let attempts = 0;
    let failures = 0;
    let lastError: unknown;
    await runWithConcurrency(c.tokens, MAX_IN_FLIGHT, async (slug) => {
      attempts += 1;
      try {
        await fetchAndCollect(slug, all, accept, http);
      } catch (err: unknown) {
        failures += 1;
        lastError = err;
        log('warn', 'teamtailor fetch failed', {
          slug,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    });
    if (attempts > 0 && failures === attempts) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'teamtailor: all tokens failed');
    }
    return all;
  },
};
