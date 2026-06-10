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
  question: string;
  normalizedKey: string;
  count: number;
  atses: string[];
  fieldKinds: string[];
  options: string[];
  required: boolean;
  jobSlugs: string[];
  firstSeen: string;
  lastSeen: string;
}

function normalize(reason: string, question: string): string {
  return (reason + '\x00' + question)
    .toLowerCase()
    .replace(/[*?.]+$/, '')
    .trim()
    .replace(/[,:;"'()]/g, '')
    .replace(/\s+/g, ' ');
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
    entries.push(parsed as GapEntry);
  }
  return entries;
}

export function clusterGaps(entries: GapEntry[]): GapCluster[] {
  const map = new Map<string, {
    counts: Map<string, number>;
    atses: Set<string>;
    fieldKinds: Set<string>;
    options: string[];
    required: boolean;
    jobSlugs: string[];
    firstSeen: string;
    lastSeen: string;
    reason: string;
    total: number;
  }>();

  for (const entry of entries) {
    const key = normalize(entry.reason, entry.question);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        counts: new Map(),
        atses: new Set(),
        fieldKinds: new Set(),
        options: [],
        required: false,
        jobSlugs: [],
        firstSeen: entry.ts,
        lastSeen: entry.ts,
        reason: entry.reason,
        total: 0,
      };
      map.set(key, bucket);
    }

    bucket.total += 1;
    bucket.counts.set(entry.question, (bucket.counts.get(entry.question) ?? 0) + 1);
    bucket.atses.add(entry.ats);
    bucket.fieldKinds.add(entry.fieldKind);
    if (bucket.options.length === 0 && entry.options.length > 0) {
      bucket.options = entry.options;
    }
    if (entry.required) bucket.required = true;
    if (!bucket.jobSlugs.includes(entry.jobSlug)) bucket.jobSlugs.push(entry.jobSlug);
    if (entry.ts < bucket.firstSeen) bucket.firstSeen = entry.ts;
    if (entry.ts > bucket.lastSeen) bucket.lastSeen = entry.ts;
  }

  const clusters: GapCluster[] = [];
  for (const [normalizedKey, bucket] of map) {
    let bestQuestion = '';
    let bestCount = 0;
    for (const [q, c] of bucket.counts) {
      if (c > bestCount) {
        bestCount = c;
        bestQuestion = q;
      }
    }
    clusters.push({
      reason: bucket.reason,
      question: bestQuestion,
      normalizedKey,
      count: bucket.total,
      atses: [...bucket.atses].sort(),
      fieldKinds: [...bucket.fieldKinds].sort(),
      options: bucket.options,
      required: bucket.required,
      jobSlugs: bucket.jobSlugs,
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

export function renderMarkdown(clusters: GapCluster[]): string {
  if (clusters.length === 0) return '';

  const header = '| reason | question | count | ats | kind | required |';
  const sep    = '|--------|----------|-------|-----|------|----------|';
  const rows = clusters.map((c) => {
    const q = c.question.length > 60 ? c.question.slice(0, 57) + '...' : c.question;
    return `| ${c.reason} | ${q} | ${c.count} | ${c.atses.join(', ')} | ${c.fieldKinds.join(', ')} | ${c.required ? 'yes' : 'no'} |`;
  });

  return [header, sep, ...rows].join('\n') + '\n';
}
