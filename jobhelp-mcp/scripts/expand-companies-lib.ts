const COMPANY_SUFFIXES: ReadonlySet<string> = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'labs', 'lab', 'ai', 'io', 'hq', 'technologies',
  'technology', 'tech', 'software', 'systems', 'group', 'holdings',
  'ventures', 'capital',
]);

export function slugVariants(name: string): string[] {
  const cleaned = name
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const words = cleaned.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (v: string): void => {
    if (v.length > 0 && !seen.has(v)) {
      seen.add(v);
      variants.push(v);
    }
  };

  let current = words;
  for (;;) {
    push(current.join('-'));
    push(current.join(''));
    if (current.length <= 1) break;
    const last = current[current.length - 1];
    if (last === undefined || !COMPANY_SUFFIXES.has(last)) break;
    current = current.slice(0, -1);
  }
  return variants;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function companyFromHnComment(html: string): string | undefined {
  const text = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?\s*p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const firstLine = decodeEntities(text)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return undefined;
  const pipe = firstLine.indexOf('|');
  if (pipe === -1) return undefined;
  const company = firstLine.slice(0, pipe).trim();
  return company.length > 0 ? company : undefined;
}

export function filterNewCandidates(
  candidates: readonly string[],
  existing: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>(existing);
  const out: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
