import type { NormalizedJob } from '../types/job.js';
import type { FetchOptions, SharedHttpOptions, SourceAdapter } from '../types/source.js';
import { httpGetText, type HttpTextResult } from './http.js';
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

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const STORY_SEARCH_HITS = 20;
const WHO_IS_HIRING_RE = /who\s+is\s+hiring/i;
// No pipe header means it is not the "Company | Role | ..." convention. Keep it
// only when it is a substantial post, not a one-line reply or thank-you note.
const MIN_PROSE_CHARS = 120;

const ROLE_RE =
  /\b(engineer|developer|programmer|designer|scientist|architect|analyst|devops|sre|manager|lead|director|founder|consultant|specialist|administrator|researcher|recruiter|full[-\s]?stack|front[-\s]?end|back[-\s]?end|data|ml|ai|qa|security|product|marketing|sales|support|head\s+of|vp)\b/i;
const SALARY_RE = /[$€£₹]\s?\d|\d[\d,.]*\s?[kKmM]\b|\b\d{2,3}[,.]?\d{3}\b|\b(?:USD|EUR|GBP|INR|CAD|AUD|CHF)\b/;
const REMOTE_ONLY_RE = /^(remote|onsite|on[-\s]?site|in[-\s]?office|hybrid|wfh|visa|interns?)\b/i;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const SYMBOL_CURRENCY: Readonly<Record<string, string>> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' };
const MAGNITUDE: Readonly<Record<string, number>> = { k: 1e3, m: 1e6 };

function decodeCodePoint(cp: number, fallback: string): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return fallback;
  return String.fromCodePoint(cp);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return decodeCodePoint(cp, match);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

function cleanText(raw: string): string {
  return decodeEntities(stripHtml(raw))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseAmount(raw: string): number | undefined {
  const m = /([\d,.]+)\s*([km])?/i.exec(raw);
  if (m === null || m[1] === undefined) return undefined;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return undefined;
  const suffix = m[2]?.toLowerCase();
  const scale = suffix !== undefined ? MAGNITUDE[suffix] ?? 1 : 1;
  return base * scale;
}

function parseSalary(segment: string): { min?: number; max?: number; currency?: string } {
  const parts = segment.split(/[-–—]|\bto\b/i);
  const min = parts[0] !== undefined ? parseAmount(parts[0]) : undefined;
  const max = parts[1] !== undefined ? parseAmount(parts[1]) : undefined;
  const explicit = /\b([A-Z]{3})\b/.exec(segment);
  let currency = explicit !== null ? explicit[1] : undefined;
  if (currency === undefined) {
    for (const [sym, code] of Object.entries(SYMBOL_CURRENCY)) {
      if (segment.includes(sym)) {
        currency = code;
        break;
      }
    }
  }
  const out: { min?: number; max?: number; currency?: string } = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  if (currency !== undefined && (min !== undefined || max !== undefined)) out.currency = currency;
  return out;
}

interface HnComment {
  readonly id: number;
  readonly createdAt: string | undefined;
  readonly text: string;
  readonly parentId: number | undefined;
}

function parseHnComment(raw: unknown): HnComment | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asNumber(raw['id']);
  const text = asString(raw['text']);
  if (id === undefined || text === undefined) return undefined;
  return { id, createdAt: asString(raw['created_at']), text, parentId: asNumber(raw['parent_id']) };
}

function firstRoleIndex(segments: readonly string[]): number {
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg !== undefined && ROLE_RE.test(seg)) return i;
  }
  return segments.length > 1 ? 1 : 0;
}

function firstSalaryIndex(segments: readonly string[], roleIndex: number): number {
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (i !== roleIndex && seg !== undefined && SALARY_RE.test(seg)) return i;
  }
  return -1;
}

function firstLocationIndex(segments: readonly string[], roleIndex: number, salaryIndex: number): number {
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (i === roleIndex || i === salaryIndex || seg === undefined) continue;
    if (REMOTE_ONLY_RE.test(seg)) continue;
    return i;
  }
  return -1;
}

function buildJob(
  comment: HnComment,
  clean: string,
  fields: { title: string; company: string; location: string; remote: NormalizedJob['remote'] },
  salary: { min?: number; max?: number; currency?: string },
): NormalizedJob {
  const iso = asIsoString(comment.createdAt);
  return {
    id: `hn:${String(comment.id)}`,
    source: 'hn',
    url: `https://news.ycombinator.com/item?id=${String(comment.id)}`,
    title: fields.title,
    company: fields.company,
    location: fields.location,
    remote: fields.remote,
    description: clean,
    ...(salary.min !== undefined ? { salaryMin: salary.min } : {}),
    ...(salary.max !== undefined ? { salaryMax: salary.max } : {}),
    ...(salary.currency !== undefined ? { salaryCurrency: salary.currency } : {}),
    ...(iso !== undefined ? { postedAt: iso } : {}),
  };
}

function parsePipeJob(comment: HnComment, clean: string, firstLine: string): NormalizedJob | undefined {
  const segments = firstLine
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length < 2) return undefined;
  const roleIndex = firstRoleIndex(segments);
  const salaryIndex = firstSalaryIndex(segments, roleIndex);
  const locationIndex = firstLocationIndex(segments, roleIndex, salaryIndex);
  const salary = salaryIndex >= 0 ? parseSalary(segments[salaryIndex] ?? '') : {};
  return buildJob(
    comment,
    clean,
    {
      title: segments[roleIndex] ?? '',
      company: segments[0] ?? '',
      location: locationIndex >= 0 ? segments[locationIndex] ?? '' : '',
      remote: detectRemoteMode(firstLine),
    },
    salary,
  );
}

function parseProseJob(comment: HnComment, clean: string, firstLine: string): NormalizedJob | undefined {
  if (clean.length < MIN_PROSE_CHARS) return undefined;
  return buildJob(comment, clean, { title: '', company: firstLine, location: '', remote: detectRemoteMode(clean) }, {});
}

function commentToJob(raw: unknown, storyId: number): NormalizedJob | undefined {
  const comment = parseHnComment(raw);
  if (comment === undefined) return undefined;
  if (comment.parentId !== undefined && comment.parentId !== storyId) return undefined;
  const clean = cleanText(comment.text);
  if (clean.length === 0) return undefined;
  const firstLine = clean.split('\n')[0]?.trim() ?? '';
  return firstLine.includes('|')
    ? parsePipeJob(comment, clean, firstLine)
    : parseProseJob(comment, clean, firstLine);
}

function matchesQueries(job: NormalizedJob, queries: readonly string[]): boolean {
  const hay = `${job.title} ${job.description}`.toLowerCase();
  return queries.some((q) => hay.includes(q.toLowerCase()));
}

async function fetchJson(url: string, label: string, http?: SharedHttpOptions): Promise<unknown> {
  let response: HttpTextResult;
  try {
    response = await httpGetText(url, { ...http });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    throw new SourceFetchError('network', `hn ${label} network error: ${msg}`);
  }
  if (!response.ok) {
    throw new SourceFetchError(classifyHttpStatus(response.status), `hn ${label} HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new SourceFetchError('parse', `hn ${label} response was not valid JSON`);
  }
}

async function fetchStoryHits(http?: SharedHttpOptions): Promise<readonly unknown[]> {
  const params = new URLSearchParams({
    tags: 'story,author_whoishiring',
    hitsPerPage: String(STORY_SEARCH_HITS),
  });
  const body = await fetchJson(`${ALGOLIA_BASE}/search_by_date?${params.toString()}`, 'story search', http);
  if (!isRecord(body)) throw new SourceFetchError('parse', 'hn story search response was not an object');
  const hits = body['hits'];
  if (!Array.isArray(hits)) throw new SourceFetchError('parse', 'hn story search response.hits was not an array');
  return hits;
}

function selectStoryId(hits: readonly unknown[]): number | undefined {
  let best: { id: number; time: number } | undefined;
  for (const hit of hits) {
    if (!isRecord(hit)) continue;
    const title = asString(hit['title']);
    const objectId = asNumber(hit['objectID']);
    if (title === undefined || objectId === undefined || !WHO_IS_HIRING_RE.test(title)) continue;
    const parsed = Date.parse(asString(hit['created_at']) ?? '');
    const time = Number.isNaN(parsed) ? 0 : parsed;
    if (best === undefined || time > best.time) best = { id: objectId, time };
  }
  return best?.id;
}

async function fetchTopLevelComments(
  storyId: number,
  http?: SharedHttpOptions,
): Promise<{ children: readonly unknown[]; storyId: number }> {
  const body = await fetchJson(`${ALGOLIA_BASE}/items/${String(storyId)}`, 'item', http);
  if (!isRecord(body)) throw new SourceFetchError('parse', 'hn item response was not an object');
  const children = body['children'];
  if (!Array.isArray(children)) throw new SourceFetchError('parse', 'hn item response.children was not an array');
  return { children, storyId: asNumber(body['id']) ?? storyId };
}

export const hn: SourceAdapter = {
  name: 'hn',
  enabled: (config): boolean => Boolean(config.sources.hn),
  fetch: async (config, opts?: FetchOptions): Promise<readonly NormalizedJob[]> => {
    const cfg = config.sources.hn;
    if (cfg === undefined) return [];
    const accept = opts?.accept;
    const http = opts?.http;
    const hits = await fetchStoryHits(http);
    const storyId = selectStoryId(hits);
    if (storyId === undefined) {
      throw new SourceFetchError('not_found', 'hn: no "Who is hiring" story found in recent whoishiring posts');
    }
    const { children, storyId: resolvedId } = await fetchTopLevelComments(storyId, http);
    const queries = cfg.queries;
    const out: NormalizedJob[] = [];
    for (const raw of children) {
      const job = commentToJob(raw, resolvedId);
      if (job === undefined) continue;
      if (queries !== undefined && queries.length > 0 && !matchesQueries(job, queries)) continue;
      if (accept !== undefined && !accept(job)) continue;
      out.push(job);
    }
    return out;
  },
};
