import type { NormalizedJob } from '../types/job.js';
import type { ApplicationEntry } from '../state/index.js';
import { normalizeCompany, titleTokenSet, tokenSetsEqual, jaccard } from './identity.js';

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
