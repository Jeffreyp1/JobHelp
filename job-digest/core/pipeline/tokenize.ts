import { escapeRegExp } from '../lib/regexp.js';

const DOMAIN_TOKENS = [
  'c++/cli',
  'c++',
  'c#',
  'f#',
  'node.js',
  'next.js',
  '.net',
] as const;
const SPLIT_RE = /[\s,;:!?()[\]{}|<>"`'~@$%^&*=]+/;
const PLACEHOLDER_RE = /^jhdomXX([0-9a-z]+)XXjhdom$/;

function buildDomainRegex(): RegExp {
  const parts = DOMAIN_TOKENS.map((t) => escapeRegExp(t)).join('|');
  return new RegExp(`(?:${parts})`, 'gi');
}

const DOMAIN_RE = buildDomainRegex();

/**
 * Tokenize a string into lowercased terms.
 *
 * - Multi-word phrases (e.g. "amazon web services") are joined with `_` before
 *   the generic split, preserving them as single tokens.
 * - Domain tokens like `c++`, `c#`, `.net`, `node.js` are preserved via a
 *   pre-pass that maps them to opaque placeholder strings (no digits, so they
 *   survive the generic split and restore unambiguously after split).
 * - Splits on whitespace and most punctuation; hyphens and slashes inside a
 *   non-domain token are kept (so `forward-deployed` stays one token).
 * - Drops tokens with length < 2.
 * - Returns an empty array for empty input.
 */
export function tokenize(
  text: string,
  multiWordPhrases: readonly string[] = [],
): readonly string[] {
  if (text.length === 0) return [];
  let working = text.toLowerCase();

  for (const phrase of multiWordPhrases) {
    const lower = phrase.toLowerCase().trim();
    if (lower.length === 0) continue;
    const joined = lower.replace(/\s+/g, '_');
    const re = new RegExp('\\b' + escapeRegExp(lower) + '\\b', 'g');
    working = working.replace(re, joined);
  }

  const placeholders: string[] = [];
  working = working.replace(DOMAIN_RE, (match) => {
    const idx = placeholders.length;
    placeholders.push(match.toLowerCase());
    return ` jhdomXX${idx.toString(36)}XXjhdom `;
  });

  const out: string[] = [];
  for (const raw of working.split(SPLIT_RE)) {
    if (raw.length === 0) continue;
    const m = raw.match(PLACEHOLDER_RE);
    if (m !== null && m[1] !== undefined) {
      const resolved = placeholders[parseInt(m[1], 36)];
      if (resolved !== undefined && resolved.length >= 2) out.push(resolved);
      continue;
    }
    const cleaned = raw.replace(/^[.\-_/]+|[.\-_/]+$/g, '');
    if (cleaned.length < 2) continue;
    out.push(cleaned);
  }
  return out;
}
