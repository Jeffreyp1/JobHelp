/**
 * templateFiller.ts
 *
 * Client-side DOCX template-fill pipeline for JobHelp.
 *
 * High-level flow ("Convert via Template (DOCX)" button):
 *   1. The user uploads a .docx file containing docxtemplater placeholders
 *      (loops like {#experiences}…{/experiences}, simple {name}, etc.) to
 *      their Drive and pastes its file id into Settings → "Drive: template
 *      DOCX file id" (`driveTemplateDocxId` storage key).
 *   2. JobHelp generates resume markdown via the existing pipeline.
 *   3. The user clicks "Convert via Template (DOCX)" in the Generate tab.
 *      The extension:
 *        a. Calls the Apps Script `download_template` action with the
 *           configured fileId; the backend returns base64 of the .docx bytes.
 *        b. Decodes the bytes into an ArrayBuffer.
 *        c. Calls `parseResumeMarkdown(md)` to coerce the markdown into a
 *           ResumeData object that mirrors the template's loop sections.
 *        d. Calls `fillResumeTemplate(buffer, data)` which uses pizzip +
 *           docxtemplater to substitute placeholders and produce a Blob.
 *        e. Re-encodes the Blob as base64 and POSTs it to the Apps Script
 *           `upload_filled_docx` action, which writes it into the per-job
 *           Drive folder and returns the file URL.
 *
 * The user creates the template once. The shipped sample lives at
 * `templates/engineering-resume-template.docx` — they can upload that as-is
 * or modify it in Word, save as .docx, then re-upload.
 *
 * This module deliberately stays browser-safe: pizzip + docxtemplater both
 * support browser bundling, and ArrayBuffer / Blob are first-class.
 *
 * Sister-of: `docxRenderer.ts` (programmatic DOCX rendering) — that path is
 * NOT replaced. The two coexist; the user picks per-resume.
 */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { log } from './structuredLog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A link inside an experience bullet (used for project URLs etc.). */
export interface BulletLink {
  text: string;
  url: string;
}

/** A single experience bullet with a bold "lead:" prefix and the rest. */
export interface ExperienceBullet {
  /** Text rendered in bold before the colon, e.g. "STAR" or "Designed and shipped". */
  lead: string;
  /** Remainder of the bullet (rendered after the bold lead + colon). */
  rest: string;
  /** Inline links inside `rest`, if any (consumed by template links module). */
  links: BulletLink[];
}

/** One job in the experience section. */
export interface ExperienceEntry {
  title: string;
  company: string;
  city: string;
  state: string;
  /** e.g. "Jun 2022 - Present" */
  dateRange: string;
  bullets: ExperienceBullet[];
}

/** One project bullet — same shape as ExperienceBullet so template renders identically. */
export interface ProjectBullet {
  /** Bolded lead phrase before the colon, e.g. "Optimized microservice throughput". Empty if the bullet has no `**lead:**` prefix. */
  lead: string;
  /** Separator inserted between lead and rest — `: ` when lead present, empty otherwise. */
  leadSep: string;
  /** Remainder of the bullet text. */
  rest: string;
}

/** One project entry. */
export interface ProjectEntry {
  title: string;
  /** Right-side metadata (URL, tech stack, etc.). Rendered as italic plain text. */
  rightInfo: string;
  bullets: ProjectBullet[];
}

/** One education line. */
export interface EducationEntry {
  school: string;
  degree: string;
  /** Right-side date, e.g. "May 2010". */
  date: string;
}

/** One skills group. */
export interface SkillsGroup {
  category: string;
  /** Comma-separated items, e.g. "Siemens NX, CATIA V5, SolidWorks". */
  items: string;
}

/** Top-level data shape consumed by the template. */
export interface ResumeData {
  name: string;
  /** "email | site | github" — used in the centered subtitle. */
  contact: string;
  skills: SkillsGroup[];
  experiences: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// fillResumeTemplate
//
// Loads the template bytes into pizzip, runs docxtemplater with paragraphLoop
// + linebreaks options enabled, substitutes the data, and emits a Blob.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill the given DOCX template with the provided resume data and return the
 * rendered DOCX as a Blob.
 *
 * @throws Error if the template can't be parsed (e.g. malformed zip or
 *               unbalanced loop tags). The error message includes the original
 *               docxtemplater error properties for debugging.
 */
export async function fillResumeTemplate(
  templateBlob: ArrayBuffer,
  data: ResumeData,
): Promise<Blob> {
  // Defensive copy: pizzip mutates the input on some code paths.
  const bytes = new Uint8Array(templateBlob.slice(0));

  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch (err) {
    throw new Error(
      `templateFiller: failed to read template zip: ${(err as Error).message}`,
    );
  }

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      // Removes loop-tag-only paragraphs (e.g. `{#experiences}`) from output.
      paragraphLoop: true,
      // Honors \n in data fields by emitting <w:br/> elements.
      linebreaks: true,
      // Ignore unmatched tags rather than throwing — empty fields are common.
      nullGetter: () => '',
    });
  } catch (err) {
    throw new Error(
      `templateFiller: failed to compile template: ${(err as Error).message}`,
    );
  }

  try {
    doc.render(data as unknown as Record<string, unknown>);
  } catch (err) {
    // docxtemplater errors carry rich properties under .properties; surface
    // the most useful bits in the message so callers can show the user.
    const e = err as Error & {
      properties?: { errors?: Array<{ message?: string }> };
    };
    const inner = e.properties?.errors?.[0]?.message ?? '';
    throw new Error(
      `templateFiller: render failed: ${e.message}${inner ? ` — ${inner}` : ''}`,
    );
  }

  // We always rebuild a Blob from raw bytes so the MIME type is correct
  // (docxtemplater's own toBlob defaults to application/zip). Pulling bytes
  // via the underlying pizzip works identically in Node and the browser.
  const out = doc.getZip().generate({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  return new Blob([out], {
    type: DOCX_MIME_TYPE,
  });
}

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─────────────────────────────────────────────────────────────────────────────
// parseResumeMarkdown
//
// Tolerant parser for the markdown shape JobHelp produces. Examples of the
// inputs each section accepts are documented per-helper below.
// ─────────────────────────────────────────────────────────────────────────────

const HEADING_NAME = /^\s*#\s+(.+)$/;
const HEADING_SECTION = /^\s*##\s+(.+)$/;

/** Split text into a list of [headingName, sectionLines[]] tuples plus a header block. */
interface ParsedSections {
  /** All non-blank lines BEFORE the first ## section heading. */
  headerLines: string[];
  /** Each section keyed by its lowercased heading. */
  sections: Map<string, string[]>;
}

function splitSections(md: string): ParsedSections {
  const lines = md.split(/\r?\n/);
  const headerLines: string[] = [];
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of lines) {
    const m = line.match(HEADING_SECTION);
    if (m) {
      current = m[1].trim().toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current === null) {
      headerLines.push(line);
    } else {
      sections.get(current)!.push(line);
    }
  }
  return { headerLines, sections };
}

function trimAll(arr: string[]): string[] {
  return arr.map((s) => s.trim());
}

function dropEmpty(arr: string[]): string[] {
  return arr.filter((s) => s.length > 0);
}

/**
 * Parse the header block: first non-blank line is `# Name`, second non-blank
 * line is the contact line. We tolerate extra blanks and missing values.
 */
function parseHeader(headerLines: string[]): { name: string; contact: string } {
  let name = '';
  let contact = '';
  for (const raw of headerLines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(HEADING_NAME);
    if (m && !name) {
      name = m[1].trim();
      continue;
    }
    if (name && !contact) {
      contact = line;
      // continue scanning in case the contact ended up split, but stop once
      // we have both.
      break;
    }
  }
  return { name, contact };
}

/**
 * Parse the Skills section.
 *
 * Accepts lines of the form:
 *   **Category:** comma, separated, items
 *   **Category**: items
 *   Category: items
 */
export function parseSkillsLines(lines: string[]): SkillsGroup[] {
  const groups: SkillsGroup[] = [];
  const unmatched: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Strip a leading `- ` or `* ` if the LLM bulleted the skills (rare).
    const stripped = line.replace(/^[-*]\s+/, '');

    // Try **Category:** items first.
    let m = stripped.match(/^\*\*([^*]+?)\s*[:：]\s*\*\*\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    // Try **Category**: items
    m = stripped.match(/^\*\*([^*]+?)\*\*\s*[:：]\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    // Plain Category: items
    m = stripped.match(/^([^:]+?)\s*[:：]\s*(.+)$/);
    if (m) {
      groups.push({ category: m[1].trim(), items: m[2].trim() });
      continue;
    }

    // No regex matched — the line is dropped from the filled DOCX. Record it
    // so this isn't an invisible "blank Skills section" (audit H6). Changing
    // the return type to surface `unmatched` to the UI is a follow-up; for now
    // we at least leave a structured trace.
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

/** Match lines like "**STAR:** Situation Task Action Result" returning {lead, rest}. */
function parseBulletLead(text: string): { lead: string; rest: string } {
  // Form 1: **lead:** rest    (colon inside bold)
  let m = text.match(/^\*\*([^*]+?)\s*[:：]\s*\*\*\s*(.*)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  // Form 2: **lead**: rest    (colon outside bold)
  m = text.match(/^\*\*([^*]+?)\*\*\s*[:：]\s*(.*)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  // No bold lead — entire line is the rest, lead is empty.
  return { lead: '', rest: text.trim() };
}

/** Pull markdown links [text](url) out of a string into a parallel array. */
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

/**
 * Parse one Experience header line.
 *
 * Accepts:
 *   **Title** Company | *— City, ST* | Jun 2022 - Present
 *   **Title** Company | City, ST | Jun 2022 - Present
 *   **Title** | Company | City, ST | Date
 */
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

  // Split on " | " — we expect at least 2 tail segments.
  const segments = tail.split(/\s*\|\s*/).filter((s) => s.length > 0);

  // Default placeholders
  let company = '';
  let city = '';
  let state = '';
  let dateRange = '';

  if (segments.length === 0) {
    return { title, company, city, state, dateRange };
  }

  // Last segment is the date range.
  dateRange = segments[segments.length - 1].trim();

  // First segment may be company (if 3 segments) or company-with-city embedded.
  const middle = segments.slice(0, segments.length - 1);

  if (middle.length >= 1) {
    // Strip leading "*— " or "— " or "- " from any segment (LLM artefacts)
    const sanitize = (s: string): string =>
      s.replace(/^\*?\s*[–—-]\s*/, '').replace(/\*+$/, '').replace(/^\*+/, '').trim();

    company = sanitize(middle[0]);

    if (middle.length >= 2) {
      // 2+ middles: company first, then "City, ST" segment.
      const loc = sanitize(middle[1]);
      const cityState = parseCityState(loc);
      city = cityState.city;
      state = cityState.state;
    } else {
      // Only one middle — company may include trailing ", City, ST" pattern
      // separated by spaces (rare). Try to peel it off.
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

function parseCityState(s: string): { city: string; state: string } {
  // "Pasadena, CA" or "Pasadena, California" or "Remote"
  const m = s.match(/^(.+?)\s*,\s*([A-Za-z]{2,})\s*$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  return { city: s.trim(), state: '' };
}

function peelCityStateFromTail(
  s: string,
): { head: string; city: string; state: string } | null {
  // Match a trailing ", City, ST" or " — City, ST"
  const m = s.match(/^(.+?)(?:\s*[—–-]\s*|\s*,\s*)([A-Za-z .]+),\s*([A-Z]{2})\s*$/);
  if (!m) return null;
  return { head: m[1].trim(), city: m[2].trim(), state: m[3].trim() };
}

/**
 * Parse the Experience section into entries. We treat each `**Title**` line as
 * a new entry; bullets follow until the next entry header or a blank-then-header.
 */
function parseExperienceLines(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  const lostLines: string[] = [];

  const startsEntry = (line: string): boolean =>
    /^\*\*[^*]+\*\*/.test(line.trim()) && !/^\s*[-*]\s+/.test(line);

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
        // Looked like an entry header but didn't parse — that's a dropped line.
        lostLines.push(trimmed);
      }
      continue;
    }

    // Bullet line.
    const bulletMatch = trimmed.match(/^[-*●]\s+(.+)$/);
    if (bulletMatch && cur) {
      const inner = bulletMatch[1].trim();
      const { lead, rest } = parseBulletLead(inner);
      const { plain, links } = extractLinks(rest);
      cur.bullets.push({ lead, rest: plain, links });
    } else if (cur && !bulletMatch) {
      // Continuation prose (a wrapped bullet, a stray paragraph) — we don't
      // append it to the previous bullet to avoid surprising the template, so
      // it's dropped from the DOCX. Record it instead of losing it silently
      // (audit H7). Surfacing `lostLines` to the UI is a follow-up.
      lostLines.push(trimmed);
    } else if (!cur && !bulletMatch) {
      // Prose before any entry header — also dropped.
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

/**
 * Parse the Projects section.
 *
 * Header line:  **Project Name** | *site.com/project* | Date
 * Bullets:      - some bullet
 */
function parseProjectLines(lines: string[]): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  let cur: ProjectEntry | null = null;

  const startsEntry = (line: string): boolean =>
    /^\*\*[^*]+\*\*/.test(line.trim()) && !/^\s*[-*]\s+/.test(line);

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
      // Right-info is everything joined by " · " minus the leading * if italic.
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
      // Try `**Lead:** rest` then `**Lead**: rest`; fall back to plain rest.
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

/**
 * Parse the Education section.
 *
 * Lines look like:
 *   **School** – PhD in Aerospace Engineering | May 2010
 *   **School** - MS in Aerospace Engineering | June 2006
 *
 * The right-side pipe segment is the date.
 */
export function parseEducationLines(lines: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const m = line.match(/^\*\*([^*]+)\*\*\s*[–—-]?\s*(.*)$/);
    if (!m) continue;
    const school = m[1].trim();
    const tail = m[2].trim();

    // Split tail on " | " to peel off date.
    const segs = tail.split(/\s*\|\s*/).filter((s) => s.length > 0);
    let degree = '';
    let date = '';
    if (segs.length === 1) {
      // No date pipe; entire tail is degree.
      degree = segs[0];
    } else {
      date = segs[segs.length - 1].trim();
      degree = segs.slice(0, segs.length - 1).join(' | ').trim();
    }

    entries.push({ school, degree, date });
  }

  return entries;
}

/**
 * Top-level markdown → ResumeData parser.
 *
 * Tolerant of variations in section headings (case-insensitive, drops trailing
 * "section"). Missing sections become empty arrays. The header (name +
 * contact) is parsed from everything BEFORE the first `## Section` heading.
 */
export function parseResumeMarkdown(md: string): ResumeData {
  const { headerLines, sections } = splitSections(md);
  const { name, contact } = parseHeader(headerLines);

  const lookup = (...keys: string[]): string[] => {
    for (const k of keys) {
      const v = sections.get(k);
      if (v) return v;
    }
    return [];
  };

  const skills = parseSkillsLines(lookup('skills', 'technical skills'));
  const experiences = parseExperienceLines(
    lookup('experience', 'professional experience', 'work experience'),
  );
  const projects = parseProjectLines(
    lookup('projects', 'selected projects', 'side projects'),
  );
  const education = parseEducationLines(
    lookup('education', 'academic background'),
  );

  return { name, contact, skills, experiences, projects, education };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers re-exported for tests
// ─────────────────────────────────────────────────────────────────────────────

/** Test-only: split `md` into header + sections. */
export const __test = {
  splitSections,
  parseHeader,
  trimAll,
  dropEmpty,
  parseExperienceLines,
  parseProjectLines,
};
