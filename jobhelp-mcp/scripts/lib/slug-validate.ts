export type AtsKind = 'workable' | 'lever' | 'smartrecruiters';

export interface SlugVerdict {
  readonly slug: string;
  readonly ats: AtsKind;
  readonly valid: boolean;
  readonly count: number;
}

export type SlugValidateErrorKind = 'bad_candidates' | 'bad_response';

export class SlugValidateError extends Error {
  readonly kind: SlugValidateErrorKind;
  readonly ctx: Record<string, unknown>;

  constructor(kind: SlugValidateErrorKind, message: string, ctx: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SlugValidateError';
    this.kind = kind;
    this.ctx = ctx;
  }
}

const ATS_KINDS: readonly AtsKind[] = ['workable', 'lever', 'smartrecruiters'];

export function isAtsKind(v: unknown): v is AtsKind {
  return typeof v === 'string' && (ATS_KINDS as readonly string[]).includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function slugMatchesName(slug: string, name: string): boolean {
  const a = normalizeName(slug);
  const b = normalizeName(name);
  if (a.length === 0 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

export function extractSlugs(parsed: unknown, sourceName: string): readonly string[] {
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed['tokens'])
      ? (parsed['tokens'] as unknown[])
      : undefined;
  if (items === undefined) {
    throw new SlugValidateError('bad_candidates', 'unrecognized candidates file shape', {
      sourceName,
    });
  }
  const out: string[] = [];
  for (const item of items) {
    const raw = typeof item === 'string' ? item : isRecord(item) ? item['slug'] : undefined;
    if (typeof raw !== 'string') {
      throw new SlugValidateError('bad_candidates', 'candidate entry is not a slug', {
        sourceName,
        entry: item,
      });
    }
    const slug = raw.trim();
    if (slug.length > 0) out.push(slug);
  }
  return out;
}

export function dedupeCandidates(lists: readonly (readonly string[])[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const slug of list) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

function parseJsonBody(ats: AtsKind, slug: string, bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new SlugValidateError('bad_response', 'malformed JSON in 200 response', { ats, slug });
  }
}

function workableVerdict(slug: string, body: unknown): SlugVerdict {
  if (!isRecord(body)) {
    throw new SlugValidateError('bad_response', 'workable account body is not an object', { slug });
  }
  const name = body['name'];
  const jobs = body['jobs'];
  const valid = typeof name === 'string' && slugMatchesName(slug, name);
  const count = valid && Array.isArray(jobs) ? jobs.length : 0;
  return { slug, ats: 'workable', valid, count };
}

function leverVerdict(slug: string, body: unknown): SlugVerdict {
  if (!Array.isArray(body)) {
    throw new SlugValidateError('bad_response', 'lever 200 body is not an array', { slug });
  }
  return { slug, ats: 'lever', valid: true, count: body.length };
}

function smartrecruitersVerdict(slug: string, body: unknown): SlugVerdict {
  const totalFound = isRecord(body) ? body['totalFound'] : undefined;
  const count =
    typeof totalFound === 'number'
      ? totalFound
      : typeof totalFound === 'string' && /^\d+$/.test(totalFound)
        ? Number(totalFound)
        : undefined;
  if (count === undefined) {
    throw new SlugValidateError('bad_response', 'smartrecruiters 200 body missing totalFound', {
      slug,
    });
  }
  return { slug, ats: 'smartrecruiters', valid: true, count };
}

export function parseVerdict(
  ats: AtsKind,
  slug: string,
  status: number,
  bodyText: string,
): SlugVerdict {
  if (status === 404) return { slug, ats, valid: false, count: 0 };
  if (status !== 200) {
    throw new SlugValidateError('bad_response', 'unexpected HTTP status', { ats, slug, status });
  }
  const body = parseJsonBody(ats, slug, bodyText);
  if (ats === 'workable') return workableVerdict(slug, body);
  if (ats === 'lever') return leverVerdict(slug, body);
  return smartrecruitersVerdict(slug, body);
}

export function stateKey(ats: AtsKind, slug: string): string {
  return JSON.stringify([ats, slug]);
}

function isVerdict(v: unknown): v is SlugVerdict {
  return (
    isRecord(v) &&
    typeof v['slug'] === 'string' &&
    isAtsKind(v['ats']) &&
    typeof v['valid'] === 'boolean' &&
    typeof v['count'] === 'number' &&
    Number.isFinite(v['count'])
  );
}

export function parseStateLines(text: string): {
  readonly verdicts: Map<string, SlugVerdict>;
  readonly malformed: number;
} {
  const verdicts = new Map<string, SlugVerdict>();
  let malformed = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }
    if (!isVerdict(parsed)) {
      malformed += 1;
      continue;
    }
    verdicts.set(stateKey(parsed.ats, parsed.slug), {
      slug: parsed.slug,
      ats: parsed.ats,
      valid: parsed.valid,
      count: parsed.count,
    });
  }
  return { verdicts, malformed };
}

export function buildOutput(
  verdicts: Iterable<SlugVerdict>,
  ats: AtsKind,
): readonly { slug: string; count: number }[] {
  const bySlug = new Map<string, SlugVerdict>();
  for (const v of verdicts) {
    if (v.ats === ats) bySlug.set(v.slug, v);
  }
  return [...bySlug.values()]
    .filter((v) => v.valid)
    .sort((a, b) => b.count - a.count || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((v) => ({ slug: v.slug, count: v.count }));
}

const RETRY_AFTER_CAP_MS = 60000;
const BACKOFF_BASE_MS = 500;

export function retryDelayMs(
  retryAfterHeader: string | null,
  attempt: number,
  nowMs: number,
): number {
  if (retryAfterHeader !== null) {
    const trimmed = retryAfterHeader.trim();
    if (/^\d+$/.test(trimmed)) {
      return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS);
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
      return Math.min(Math.max(dateMs - nowMs, 0), RETRY_AFTER_CAP_MS);
    }
  }
  return BACKOFF_BASE_MS * 2 ** attempt;
}

export interface TokenBucketClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface TokenBucket {
  acquire(): Promise<void>;
}

const realClock: TokenBucketClock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createTokenBucket(rps: number, clock: TokenBucketClock = realClock): TokenBucket {
  let tokens = rps;
  let lastRefill = clock.now();
  return {
    async acquire(): Promise<void> {
      for (;;) {
        const now = clock.now();
        tokens = Math.min(rps, tokens + ((now - lastRefill) / 1000) * rps);
        lastRefill = now;
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        await clock.sleep(Math.ceil(((1 - tokens) / rps) * 1000));
      }
    },
  };
}
