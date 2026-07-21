import { log } from '../lib/log.js';
import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
import {
  SourceFetchError,
  asIsoString,
  classifyHttpStatus,
  runWithConcurrency,
} from './_shared.js';

export { SourceFetchError };

const WWR_CONCURRENCY = 5;
const MAIN_FEED = 'https://weworkremotely.com/remote-jobs.rss';

function categoryFeedUrl(category: string): string {
  return `https://weworkremotely.com/categories/${encodeURIComponent(category)}.rss`;
}

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

function deriveId(block: string, link: string): string {
  const guid = extractTag(block, 'guid');
  if (guid !== undefined && guid.length > 0) return guid;
  const m = /\/remote-jobs\/([^/?#]+)/.exec(link);
  return m !== null && m[1] !== undefined ? m[1] : link;
}

// WWR titles are "Company Name: Job Title"; split on the first ": ".
function splitTitle(rawTitle: string): { company: string; title: string } {
  const idx = rawTitle.indexOf(': ');
  if (idx === -1) return { company: '', title: rawTitle };
  return {
    company: rawTitle.slice(0, idx).trim(),
    title: rawTitle.slice(idx + 2).trim(),
  };
}

interface WwrItem {
  readonly id: string;
  readonly company: string;
  readonly title: string;
  readonly link: string;
  readonly description: string;
  readonly location: string;
  readonly publishedAt: string | undefined;
}

function parseItem(block: string): WwrItem | undefined {
  const rawTitle = extractTag(block, 'title');
  const link = extractTag(block, 'link');
  if (rawTitle === undefined || link === undefined) return undefined;
  const { company, title } = splitTitle(rawTitle);
  const description = stripHtml(extractTag(block, 'description') ?? '');
  // WWR <item>s carry a <region> tag, but it can be absent or empty on some
  // categories; treat blank as the implicit "Remote" the whole board is.
  const region = extractTag(block, 'region');
  const location = region !== undefined && region.length > 0 ? region : 'Remote';
  return {
    id: deriveId(block, link),
    company,
    title,
    link,
    description,
    location,
    publishedAt: extractTag(block, 'pubDate'),
  };
}

function normalize(item: WwrItem): NormalizedJob {
  const norm: NormalizedJob = {
    id: `weworkremotely:${item.id}`,
    source: 'weworkremotely',
    url: item.link,
    title: item.title,
    company: item.company,
    location: item.location,
    remote: 'remote',
    description: item.description,
    ...((): { postedAt: string } | object => {
      const iso = asIsoString(item.publishedAt);
      return iso !== undefined ? { postedAt: iso } : {};
    })(),
  };
  return norm;
}

async function fetchFeed(url: string, http?: SharedHttpOptions): Promise<string> {
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `weworkremotely network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `weworkremotely HTTP ${response.status}`);
  }
  const contentType = response.contentType.toLowerCase();
  const text = response.bodyText;
  if (!contentType.includes('xml') && !contentType.includes('rss') && !/<rss\b/i.test(text)) {
    throw new SourceFetchError('parse', `weworkremotely: non-RSS content-type (${contentType})`);
  }
  if (!/<item\b/i.test(text)) {
    throw new SourceFetchError('parse', 'weworkremotely: feed had no <item> elements');
  }
  return text;
}

async function fetchOne(
  url: string,
  accept?: (job: NormalizedJob) => boolean,
  http?: SharedHttpOptions,
): Promise<NormalizedJob[]> {
  const xml = await fetchFeed(url, http);
  const out: NormalizedJob[] = [];
  for (const block of extractAllItems(xml)) {
    const parsed = parseItem(block);
    if (parsed === undefined) continue;
    const job = normalize(parsed);
    if (accept !== undefined && !accept(job)) continue;
    out.push(job);
  }
  return out;
}

export const weworkremotely: SourceAdapter = {
  name: 'weworkremotely',
  enabled: (config): boolean => Boolean(config.sources.weworkremotely),
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const c = config.sources.weworkremotely;
    if (c === undefined) {
      throw new SourceFetchError('auth', 'weworkremotely config missing');
    }
    const accept = opts?.accept;
    const http = opts?.http;
    const categories = c.categories ?? [];
    const urls = categories.length > 0 ? categories.map(categoryFeedUrl) : [MAIN_FEED];
    const tasks = urls.map((url) => (): Promise<NormalizedJob[]> => fetchOne(url, accept, http));
    const settled = await runWithConcurrency(tasks, { limit: WWR_CONCURRENCY });
    const all: NormalizedJob[] = [];
    let failures = 0;
    let lastError: unknown;
    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i];
      if (r === undefined) continue;
      if (r.status === 'fulfilled') {
        for (const job of r.value) all.push(job);
      } else {
        failures += 1;
        lastError = r.reason;
        log('warn', 'weworkremotely fetch failed', {
          url: urls[i],
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    }
    if (urls.length > 0 && failures === urls.length) {
      if (lastError instanceof Error) throw lastError;
      throw new SourceFetchError('unknown', 'weworkremotely: all feeds failed');
    }
    return all;
  },
};
