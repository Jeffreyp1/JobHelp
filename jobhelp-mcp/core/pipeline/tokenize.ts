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

const DOMAIN_RE = new RegExp(
  `(?:${DOMAIN_TOKENS.map((t) => escapeRegExp(t)).join('|')})`,
  'gi',
);

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

  // Map domain tokens to opaque placeholders so they survive the generic split.
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
