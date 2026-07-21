import type { NormalizedJob } from '../types/job.js';
import type { ApplicationEntry } from '../state/index.js';
import { tokenize } from './tokenize.js';

const DEFAULT_BOOST_CAP = 1.15;
const JACCARD_FLOOR = 0.4;

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

// Application entries store companies as slugs ("abnormalsecurity") while jobs
// carry display names ("Abnormal Security"), so spaces/punctuation must go.
function normalizeCompany(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleTokenSet(raw: string): ReadonlySet<string> {
  return new Set(tokenize(raw));
}

function tokenSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const t of a) {
    if (!b.has(t)) return false;
  }
  return true;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

interface PreparedApplication {
  readonly jobId: string;
  readonly url: string | undefined;
  readonly company: string;
  readonly titleTokens: ReadonlySet<string>;
}

function prepare(applications: readonly ApplicationEntry[]): readonly PreparedApplication[] {
  return applications.map((app) => ({
    jobId: app.jobId,
    url: app.url !== undefined ? normalizeUrl(app.url) : undefined,
    company: normalizeCompany(app.company),
    titleTokens: titleTokenSet(app.role),
  }));
}

export function appliedJobIds(
  jobs: readonly NormalizedJob[],
  applications: readonly ApplicationEntry[],
): ReadonlySet<string> {
  const out = new Set<string>();
  if (applications.length === 0) return out;
  const prepared = prepare(applications);
  for (const job of jobs) {
    const url = normalizeUrl(job.url);
    const company = normalizeCompany(job.company);
    const titleTokens = titleTokenSet(job.title);
    const matched = prepared.some(
      (app) =>
        app.jobId === job.id ||
        (app.url !== undefined && url !== undefined && app.url === url) ||
        (app.company.length > 0 &&
          app.company === company &&
          tokenSetsEqual(app.titleTokens, titleTokens)),
    );
    if (matched) out.add(job.id);
  }
  return out;
}

export interface HistoryBoostOptions {
  readonly cap?: number;
}

export function historyBoostsFor(
  jobs: readonly NormalizedJob[],
  applications: readonly ApplicationEntry[],
  opts?: HistoryBoostOptions,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (applications.length === 0) return out;
  const cap = Math.max(1, opts?.cap ?? DEFAULT_BOOST_CAP);
  const applied = appliedJobIds(jobs, applications);
  const prepared = prepare(applications);
  for (const job of jobs) {
    if (applied.has(job.id)) continue;
    const company = normalizeCompany(job.company);
    const titleTokens = titleTokenSet(job.title);
    let boost = 0;
    for (const app of prepared) {
      if (app.company.length > 0 && app.company === company) {
        boost = cap;
        break;
      }
      const similarity = jaccard(titleTokens, app.titleTokens);
      if (similarity >= JACCARD_FLOOR) {
        const scaled = 1 + (cap - 1) * ((similarity - JACCARD_FLOOR) / (1 - JACCARD_FLOOR));
        if (scaled > boost) boost = scaled;
      }
    }
    if (boost >= 1) out.set(job.id, boost);
  }
  return out;
}
