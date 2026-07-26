import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CanaryCandidateInputs {
  readonly applications: ReadonlyArray<{ readonly url?: string }>;
  readonly digestUrls: readonly string[];
  readonly atsOf: (url: string) => string | null;
  readonly perAts?: number;
}

export function sampleCandidates(i: CanaryCandidateInputs): Record<string, string[]> {
  const cap = i.perAts ?? 4;
  const out: Record<string, string[]> = {};
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (url === undefined || url === '' || seen.has(url)) return;
    const ats = i.atsOf(url);
    if (ats === null) return;
    const list = (out[ats] ??= []);
    if (list.length >= cap) return;
    seen.add(url);
    list.push(url);
  };
  for (const app of i.applications) add(app.url);
  for (const url of i.digestUrls) add(url);
  return out;
}

// Persisted digests hold RankedJob entries whose url is nested (`{ job: { url } }`);
// a flat top-level `url` is accepted defensively.
function entryUrl(j: unknown): unknown {
  if (typeof j !== 'object' || j === null) return undefined;
  const r = j as Record<string, unknown>;
  if (typeof r['url'] === 'string') return r['url'];
  const job = r['job'];
  if (typeof job !== 'object' || job === null) return undefined;
  return (job as Record<string, unknown>)['url'];
}

function jobsUrls(v: unknown): string[] | null {
  if (typeof v !== 'object' || v === null) return null;
  const jobs = (v as Record<string, unknown>)['jobs'];
  if (!Array.isArray(jobs)) return null;
  return jobs.map(entryUrl).filter((u): u is string => typeof u === 'string' && u !== '');
}

export async function readLatestDigestUrls(stateRootDir: string): Promise<string[]> {
  try {
    // latest.json is owned by jobhelp-mcp; it may either be the full digest (has
    // `jobs`) or a `{ date }` pointer to digest-<date>.json. Handle both without
    // importing MCP code; anything unexpected yields [] since the canary is best-effort.
    const pointer: unknown = JSON.parse(await readFile(join(stateRootDir, 'digests', 'latest.json'), 'utf8'));
    const direct = jobsUrls(pointer);
    if (direct !== null) return direct;
    if (typeof pointer !== 'object' || pointer === null) return [];
    const date = (pointer as Record<string, unknown>)['date'];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const digest: unknown = JSON.parse(await readFile(join(stateRootDir, 'digests', `digest-${date}.json`), 'utf8'));
    return jobsUrls(digest) ?? [];
  } catch {
    return [];
  }
}
