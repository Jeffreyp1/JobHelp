import { tokenize } from './tokenize.js';

// Application entries store companies as slugs ("abnormalsecurity") while jobs
// carry display names ("Abnormal Security"), so spaces/punctuation must go.
export function normalizeCompany(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function titleTokenSet(raw: string): ReadonlySet<string> {
  return new Set(tokenize(raw));
}

export function tokenSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const t of a) {
    if (!b.has(t)) return false;
  }
  return true;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

// Order-independent identity of a (company, title) pair: a normalized company
// joined to its sorted title-token set, so case, punctuation, and word order of
// the same role collapse to one key.
export function identityKey(company: string, title: string): string {
  return `${normalizeCompany(company)} ${[...titleTokenSet(title)].sort().join(' ')}`;
}
