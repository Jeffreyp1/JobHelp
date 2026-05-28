import { log } from './structuredLog.js';
import type {
  BulletLink,
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  SkillsGroup,
} from './templateFiller-types.js';

const ENTRY_HEADER = /^\*\*[^*]+\*\*/;
const BULLET_LINE = /^\s*[-*]\s+/;

export function parseSkillsLines(lines: string[]): SkillsGroup[] {
  const groups: SkillsGroup[] = [];
  const unmatched: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const stripped = line.replace(/^[-*]\s+/, '');

    let m = stripped.match(/^\*\*([^*]+?)\s*[:：]\s*\*\*\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    m = stripped.match(/^\*\*([^*]+?)\*\*\s*[:：]\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    m = stripped.match(/^([^:]+?)\s*[:：]\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    unmatched.push(line);
  }
  if (unmatched.length > 0) {
    log('warn', 'templateFiller: dropped unrecognised Skills line(s)', {
      count: unmatched.length,
      samples: unmatched.slice(0, 5),
    });
  }
  return groups;
}

function parseBulletLead(text: string): { lead: string; rest: string } {
  let m = text.match(/^\*\*([^*]+?)\s*[:：]\s*\*\*\s*(.*)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  m = text.match(/^\*\*([^*]+?)\*\*\s*[:：]\s*(.*)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  return { lead: '', rest: text.trim() };
}

export function extractLinks(text: string): { plain: string; links: BulletLink[] } {
  const links: BulletLink[] = [];
  const plain = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_full, t: string, u: string) => {
      links.push({ text: t, url: u });
      return t;
    },
  );
  return { plain, links };
}

export function parseExperienceHeader(line: string): {
  title: string;
  company: string;
  city: string;
  state: string;
  dateRange: string;
} | null {
  const m = line.match(/^\*\*([^*]+)\*\*\s*(.*)$/);
  if (!m) return null;
  const title = m[1].trim();
  const tail = m[2].trim();
  const segments = tail.split(/\s*\|\s*/).filter((s) => s.length > 0);
  let company = '';
  let city = '';
  let state = '';
  let dateRange = '';

  if (segments.length === 0) {
    return { title, company, city, state, dateRange };
  }

  dateRange = segments[segments.length - 1].trim();

  const middle = segments.slice(0, segments.length - 1);

  if (middle.length >= 1) {
    company = sanitizeHeaderSegment(middle[0]);

    if (middle.length >= 2) {
      const loc = sanitizeHeaderSegment(middle[1]);
      const cityState = parseCityState(loc);
      city = cityState.city;
      state = cityState.state;
    } else {
      const cityState = peelCityStateFromTail(company);
      if (cityState) {
        company = cityState.head;
        city = cityState.city;
        state = cityState.state;
      }
    }
  }

  return { title, company, city, state, dateRange };
}

function sanitizeHeaderSegment(s: string): string {
  return s.replace(/^\*?\s*[–—-]\s*/, '').replace(/\*+$/, '').replace(/^\*+/, '').trim();
}

function parseCityState(s: string): { city: string; state: string } {
  const m = s.match(/^(.+?)\s*,\s*([A-Za-z]{2,})\s*$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  return { city: s.trim(), state: '' };
}

function peelCityStateFromTail(
  s: string,
): { head: string; city: string; state: string } | null {
  const m = s.match(/^(.+?)(?:\s*[—–-]\s*|\s*,\s*)([A-Za-z .]+),\s*([A-Z]{2})\s*$/);
  if (!m) return null;
  return { head: m[1].trim(), city: m[2].trim(), state: m[3].trim() };
}

function startsEntry(line: string): boolean {
  return ENTRY_HEADER.test(line.trim()) && !BULLET_LINE.test(line);
}

export function parseExperienceLines(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  const lostLines: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (startsEntry(trimmed)) {
      const header = parseExperienceHeader(trimmed);
      if (header) {
        cur = { ...header, bullets: [] };
        entries.push(cur);
      } else {
        lostLines.push(trimmed);
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*●]\s+(.+)$/);
    if (bulletMatch && cur) {
      const inner = bulletMatch[1].trim();
      const { lead, rest } = parseBulletLead(inner);
      const { plain, links } = extractLinks(rest);
      cur.bullets.push({ lead, rest: plain, links });
    } else if (cur && !bulletMatch) {
      lostLines.push(trimmed);
    } else if (!cur && !bulletMatch) {
      lostLines.push(trimmed);
    }
  }

  if (lostLines.length > 0) {
    log('warn', 'templateFiller: dropped non-bullet/continuation line(s) in Experience', {
      count: lostLines.length,
      samples: lostLines.slice(0, 5),
    });
  }

  return entries;
}

export function parseProjectLines(lines: string[]): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  let cur: ProjectEntry | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (startsEntry(trimmed)) {
      const m = trimmed.match(/^\*\*([^*]+)\*\*\s*(.*)$/);
      if (!m) continue;
      const title = m[1].trim();
      const tail = m[2].trim();
      const segments = tail.split(/\s*\|\s*/).filter((s) => s.length > 0);
      const rightInfo = segments
        .map((s) => s.replace(/^\*+/, '').replace(/\*+$/, '').trim())
        .filter((s) => s.length > 0)
        .join(' · ');
      cur = { title, rightInfo, bullets: [] };
      entries.push(cur);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*●]\s+(.+)$/);
    if (bulletMatch && cur) {
      const text = bulletMatch[1].trim();
      let lm = text.match(/^\*\*([^*]+?)\s*[:：]\s*\*\*\s*(.*)$/);
      if (!lm) lm = text.match(/^\*\*([^*]+?)\*\*\s*[:：]\s*(.*)$/);
      if (lm) {
        cur.bullets.push({ lead: lm[1].trim(), leadSep: ': ', rest: lm[2].trim() });
      } else {
        cur.bullets.push({ lead: '', leadSep: '', rest: text });
      }
    }
  }

  return entries;
}

export function parseEducationLines(lines: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const m = line.match(/^\*\*([^*]+)\*\*\s*[–—-]?\s*(.*)$/);
    if (!m) continue;
    const school = m[1].trim();
    const tail = m[2].trim();
    const segs = tail.split(/\s*\|\s*/).filter((s) => s.length > 0);
    let degree = '';
    let date = '';
    if (segs.length === 1) {
      degree = segs[0];
    } else {
      date = segs[segs.length - 1].trim();
      degree = segs.slice(0, segs.length - 1).join(' | ').trim();
    }

    entries.push({ school, degree, date });
  }

  return entries;
}
