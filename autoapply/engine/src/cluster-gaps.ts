export interface GapEntry {
  ts: string;
  ats: string;
  company: string;
  jobSlug: string;
  url: string;
  question: string;
  fieldKind: string;
  options: string[];
  required: boolean;
  reason: string;
  filledBy: string;
  notes: string;
  [key: string]: unknown;
}

export interface GapCluster {
  reason: string;
  reasons: string[];
  question: string;
  normalizedKey: string;
  count: number;
  atses: string[];
  fieldKinds: string[];
  options: string[];
  required: boolean;
  jobSlugs: string[];
  notes: string[];
  firstSeen: string;
  lastSeen: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Company mentions are folded to {company} BEFORE lowercasing so the
// capitalized-proper-noun pattern still fires; otherwise "worked at MongoDB"
// and "worked at Twilio" land in separate clusters forever.
function foldCompany(question: string, company: string): string {
  let q = question;
  const name = company.trim();
  if (name !== '') {
    q = q.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), '{company}');
  }
  q = q.replace(
    /\b(at|join|joining)\s+(?!the\b)([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/g,
    '$1 {company}',
  );
  return q;
}

function normalize(question: string): string {
  return question
    .toLowerCase()
    .trim()
    .replace(/[*?.:]+$/, '')
    .replace(/[,:;"'()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clusterKey(question: string, company: string): string {
  return normalize(foldCompany(question, company));
}

export function parseGapLines(raw: string): GapEntry[] {
  const entries: GapEntry[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1}`);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('question' in parsed) ||
      typeof (parsed as Record<string, unknown>)['question'] !== 'string'
    ) {
      throw new Error(`Missing required field "question" on line ${i + 1}`);
    }
    if (
      !('reason' in parsed) ||
      typeof (parsed as Record<string, unknown>)['reason'] !== 'string'
    ) {
      throw new Error(`Missing required field "reason" on line ${i + 1}`);
    }
    const row = parsed as Record<string, unknown>;
    entries.push({
      ...row,
      ts: typeof row['ts'] === 'string' ? row['ts'] : '',
      ats: typeof row['ats'] === 'string' ? row['ats'] : '',
      company: typeof row['company'] === 'string' ? row['company'] : '',
      jobSlug: typeof row['jobSlug'] === 'string' ? row['jobSlug'] : '',
      url: typeof row['url'] === 'string' ? row['url'] : '',
      question: row['question'] as string,
      fieldKind: typeof row['fieldKind'] === 'string' ? row['fieldKind'] : '',
      options: Array.isArray(row['options']) ? row['options'].filter((o): o is string => typeof o === 'string') : [],
      required: row['required'] === true,
      reason: row['reason'] as string,
      filledBy: typeof row['filledBy'] === 'string' ? row['filledBy'] : '',
      notes: typeof row['notes'] === 'string' ? row['notes'] : '',
    });
  }
  return entries;
}

interface Bucket {
  questionCounts: Map<string, number>;
  reasonCounts: Map<string, number>;
  atses: Set<string>;
  fieldKinds: Set<string>;
  options: string[];
  required: boolean;
  jobSlugs: string[];
  notes: string[];
  firstSeen: string;
  lastSeen: string;
  total: number;
}

function mostFrequent(counts: Map<string, number>): string {
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}

export function clusterGaps(entries: GapEntry[]): GapCluster[] {
  const map = new Map<string, Bucket>();

  for (const entry of entries) {
    const key = clusterKey(entry.question, entry.company);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        questionCounts: new Map(),
        reasonCounts: new Map(),
        atses: new Set(),
        fieldKinds: new Set(),
        options: [],
        required: false,
        jobSlugs: [],
        notes: [],
        firstSeen: entry.ts,
        lastSeen: entry.ts,
        total: 0,
      };
      map.set(key, bucket);
    }

    bucket.total += 1;
    bucket.questionCounts.set(entry.question, (bucket.questionCounts.get(entry.question) ?? 0) + 1);
    bucket.reasonCounts.set(entry.reason, (bucket.reasonCounts.get(entry.reason) ?? 0) + 1);
    bucket.atses.add(entry.ats);
    bucket.fieldKinds.add(entry.fieldKind);
    if (bucket.options.length === 0 && entry.options.length > 0) {
      bucket.options = entry.options;
    }
    if (entry.required) bucket.required = true;
    if (!bucket.jobSlugs.includes(entry.jobSlug)) bucket.jobSlugs.push(entry.jobSlug);
    if (entry.notes !== '' && !bucket.notes.includes(entry.notes)) bucket.notes.push(entry.notes);
    if (entry.ts < bucket.firstSeen) bucket.firstSeen = entry.ts;
    if (entry.ts > bucket.lastSeen) bucket.lastSeen = entry.ts;
  }

  const clusters: GapCluster[] = [];
  for (const [normalizedKey, bucket] of map) {
    clusters.push({
      reason: mostFrequent(bucket.reasonCounts),
      reasons: [...bucket.reasonCounts.keys()].sort(),
      question: mostFrequent(bucket.questionCounts),
      normalizedKey,
      count: bucket.total,
      atses: [...bucket.atses].sort(),
      fieldKinds: [...bucket.fieldKinds].sort(),
      options: bucket.options,
      required: bucket.required,
      jobSlugs: bucket.jobSlugs,
      notes: bucket.notes,
      firstSeen: bucket.firstSeen,
      lastSeen: bucket.lastSeen,
    });
  }

  clusters.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  return clusters;
}

function cell(text: string, max: number): string {
  const flat = text.replace(/\|/g, '\\|');
  return flat.length > max ? flat.slice(0, max - 3) + '...' : flat;
}

export function renderMarkdown(clusters: GapCluster[]): string {
  if (clusters.length === 0) return '';

  const header = '| reason | question | count | ats | kind | required | options | notes |';
  const sep    = '|--------|----------|-------|-----|------|----------|---------|-------|';
  const rows = clusters.map((c) => {
    const q = cell(c.question, 60);
    const options = cell(c.options.join(' / '), 60);
    const notes = cell(c.notes.join('; '), 80);
    return `| ${c.reason} | ${q} | ${c.count} | ${c.atses.join(', ')} | ${c.fieldKinds.join(', ')} | ${c.required ? 'yes' : 'no'} | ${options} | ${notes} |`;
  });

  return [header, sep, ...rows].join('\n') + '\n';
}
