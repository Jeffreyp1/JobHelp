import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { log } from '../lib/log.js';

export type HarvestSource =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee'
  | 'breezy'
  | 'teamtailor'
  | 'pinpoint';

export class HarvestError extends Error {
  readonly type = 'harvest' as const;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HarvestError';
  }
}

interface HarvestableJob {
  readonly url?: string;
  readonly applyUrl?: string;
}

const FIELD_BY_SOURCE: Readonly<Record<HarvestSource, 'tokens' | 'slugs'>> = {
  greenhouse: 'tokens',
  lever: 'slugs',
  ashby: 'tokens',
  workable: 'tokens',
  smartrecruiters: 'tokens',
  recruitee: 'tokens',
  breezy: 'tokens',
  teamtailor: 'tokens',
  pinpoint: 'tokens',
};

const SUBDOMAIN_SUFFIXES: readonly (readonly [string, HarvestSource])[] = [
  ['recruitee.com', 'recruitee'],
  ['breezy.hr', 'breezy'],
  ['teamtailor.com', 'teamtailor'],
  ['pinpointhq.com', 'pinpoint'],
];

// Subdomains that carry infrastructure/marketing pages rather than a company's
// job board — <www>.recruitee.com is the vendor site, not a tenant.
const GENERIC_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'app', 'apps', 'api', 'jobs', 'careers', 'apply', 'help',
  'support', 'blog', 'about', 'mail', 'login', 'auth', 'static',
  'cdn', 'assets', 'go', 'my', 'account', 'accounts',
]);

function normalizeToken(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded.trim().toLowerCase();
}

function mk(source: HarvestSource, raw: string): { source: HarvestSource; token: string } | undefined {
  const token = normalizeToken(raw);
  if (token.length === 0) return undefined;
  return { source, token };
}

function matchAtsUrl(rawUrl: string): { source: HarvestSource; token: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  const first = segments[0];

  if (host === 'greenhouse.io' || host.endsWith('.greenhouse.io')) {
    if (parsed.pathname.startsWith('/embed/job_app')) {
      const forParam = parsed.searchParams.get('for');
      return forParam !== null && forParam.length > 0 ? mk('greenhouse', forParam) : undefined;
    }
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
      return first !== undefined && first !== 'embed' ? mk('greenhouse', first) : undefined;
    }
    return undefined;
  }
  if (host === 'jobs.lever.co') {
    return first !== undefined ? mk('lever', first) : undefined;
  }
  if (host === 'jobs.ashbyhq.com') {
    return first !== undefined ? mk('ashby', first) : undefined;
  }
  if (host === 'apply.workable.com') {
    return first !== undefined && first !== 'j' ? mk('workable', first) : undefined;
  }
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    return first !== undefined ? mk('smartrecruiters', first) : undefined;
  }
  for (const [suffix, source] of SUBDOMAIN_SUFFIXES) {
    if (!host.endsWith('.' + suffix)) continue;
    const sub = host.slice(0, host.length - suffix.length - 1);
    const label = sub.split('.')[0];
    if (label === undefined || label.length === 0 || GENERIC_SUBDOMAINS.has(label)) return undefined;
    return mk(source, label);
  }
  return undefined;
}

export function extractAtsTokens(jobs: readonly HarvestableJob[]): Map<HarvestSource, Set<string>> {
  const out = new Map<HarvestSource, Set<string>>();
  for (const job of jobs) {
    for (const candidate of [job.url, job.applyUrl]) {
      if (candidate === undefined || candidate.length === 0) continue;
      const match = matchAtsUrl(candidate);
      if (match === undefined) continue;
      let set = out.get(match.source);
      if (set === undefined) {
        set = new Set<string>();
        out.set(match.source, set);
      }
      set.add(match.token);
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export async function harvestNewCompanyTokens(
  jobs: readonly HarvestableJob[],
  companySourcesPath: string,
): Promise<Partial<Record<HarvestSource, number>>> {
  const extracted = extractAtsTokens(jobs);
  if (extracted.size === 0) return {};

  let raw: string;
  try {
    raw = await readFile(companySourcesPath, 'utf8');
  } catch (e: unknown) {
    if (isRecord(e) && e['code'] === 'ENOENT') return {};
    throw new HarvestError(`failed to read ${companySourcesPath}`, { cause: e });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    throw new HarvestError(`malformed JSON in ${companySourcesPath}`, { cause: e });
  }
  if (!isRecord(parsed)) {
    throw new HarvestError(`${companySourcesPath} must contain a JSON object`);
  }

  const added: Partial<Record<HarvestSource, number>> = {};
  let changed = false;

  for (const [source, tokens] of extracted) {
    const block = parsed[source];
    if (!isRecord(block)) continue;
    const field = FIELD_BY_SOURCE[source];
    const existing = block[field];
    if (!isStringArray(existing)) continue;
    const known = new Set(existing.map((t) => t.toLowerCase()));
    const fresh: string[] = [];
    for (const token of tokens) {
      if (known.has(token)) continue;
      known.add(token);
      fresh.push(token);
    }
    if (fresh.length === 0) continue;
    block[field] = [...existing, ...fresh];
    added[source] = fresh.length;
    changed = true;
  }

  if (!changed) return {};

  const write = await atomicWriteFile(companySourcesPath, JSON.stringify(parsed, null, 2) + '\n');
  if (!write.ok) {
    throw new HarvestError(`failed to write ${companySourcesPath}: ${write.error.message}`);
  }

  for (const [source, count] of Object.entries(added)) {
    log('info', 'harvested new company tokens', { source, added: count });
  }
  return added;
}
