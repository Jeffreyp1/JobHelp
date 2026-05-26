import type { NormalizedJob } from '../types/index.js';

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString().toLowerCase();
  } catch {
    return normalizeText(value.split(/[?#]/, 1)[0] ?? value);
  }
}

function postingKey(job: NormalizedJob): string {
  return [
    normalizeText(job.company),
    normalizeText(job.title),
    canonicalUrl(job.url),
  ].join('\u0000');
}

export async function dedupe(
  jobs: readonly NormalizedJob[],
): Promise<readonly NormalizedJob[]> {
  const seenIds = new Set<string>();
  const seenPostings = new Set<string>();
  const deduped: NormalizedJob[] = [];
  for (const job of jobs) {
    const key = postingKey(job);
    if (seenIds.has(job.id) || seenPostings.has(key)) continue;
    seenIds.add(job.id);
    seenPostings.add(key);
    deduped.push(job);
  }
  return deduped;
}
