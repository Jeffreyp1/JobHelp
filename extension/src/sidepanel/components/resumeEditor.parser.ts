/**
 * Pure markdown parser for the JobHelp resume shape:
 *   ## H2 = section
 *   ### H3 = role
 *   - bullet
 *
 * Also exposes the deterministic CRC32-based bullet ID so re-rendering
 * identical markdown produces identical IDs across edits.
 */

const CRC32_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function bulletIdFor(bulletText: string, sectionIndex: number): string {
  const trimmed = bulletText.trim();
  const hex = crc32(`${sectionIndex}:${trimmed}`).toString(16).padStart(8, '0');
  return `b-${hex}`;
}

export interface ParsedBullet {
  kind: 'bullet';
  text: string;
  bulletId: string;
}
export interface ParsedRole {
  kind: 'role';
  rawHeading: string;
  companyName: string;
  children: ParsedNode[];
}
export interface ParsedSection {
  kind: 'section';
  sectionName: string;
  children: ParsedNode[];
}
export interface ParsedText {
  kind: 'text';
  text: string;
}
export type ParsedNode = ParsedBullet | ParsedRole | ParsedSection | ParsedText;

/**
 * Extract a company token from an H3 heading like:
 *   "Senior Software Engineer at Acme Cloud (Mar 2022 - Present)"
 *   "Senior Engineer — Brightline Analytics | *Python* | Jul 2019 - Feb 2022"
 *   "**Senior Software Engineer** Acme Cloud Inc | *Go* | Mar 2022 - Present"
 */
export function extractCompanyName(heading: string): string {
  const stripped = heading
    .replace(/^\s*#+\s*/, '')
    .replace(/\s*\(\s*[^)]*\d{4}[^)]*\)\s*$/, '')
    .trim();

  let m = stripped.match(/^.+?\s+at\s+(.+?)(?:\s*[|—-]\s*.*)?$/i);
  if (m && m[1]) return m[1].trim();

  m = stripped.match(/^.+?\s+[—–]\s+(.+?)(?:\s*[|]\s*.*)?$/);
  if (m && m[1]) return m[1].trim();

  m = stripped.match(/^\*\*[^*]+\*\*\s+(.+?)(?:\s*[|]\s*.*)?$/);
  if (m && m[1]) return m[1].trim();

  const firstSeg = stripped.split('|')[0] ?? stripped;
  return firstSeg.replace(/\*\*/g, '').trim();
}

export function parseResumeMarkdown(md: string): ParsedNode[] {
  const lines = md.split('\n');
  const root: ParsedNode[] = [];
  let currentSection: ParsedSection | null = null;
  let currentRole: ParsedRole | null = null;
  let sectionIndex = -1;

  const addToCurrent = (node: ParsedNode): void => {
    if (currentRole) currentRole.children.push(node);
    else if (currentSection) currentSection.children.push(node);
    else root.push(node);
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      sectionIndex += 1;
      currentSection = {
        kind: 'section',
        sectionName: h2[1].trim(),
        children: [],
      };
      currentRole = null;
      root.push(currentSection);
      continue;
    }

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      const raw = h3[1].trim();
      currentRole = {
        kind: 'role',
        rawHeading: raw,
        companyName: extractCompanyName(raw),
        children: [],
      };
      if (currentSection) currentSection.children.push(currentRole);
      else root.push(currentRole);
      continue;
    }

    const bullet = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (bullet) {
      const text = bullet[1].trim();
      addToCurrent({
        kind: 'bullet',
        text,
        bulletId: bulletIdFor(text, Math.max(0, sectionIndex)),
      });
      continue;
    }

    if (trimmed.length > 0) {
      addToCurrent({ kind: 'text', text: trimmed });
    }
  }
  return root;
}

/**
 * Update the bullet line in markdown identified by `bulletId`. Walks each line,
 * recomputes the section index, and replaces the matching bullet line with the
 * new text (preserving the original line's leading whitespace + bullet glyph).
 */
export function updateBulletLine(md: string, bulletId: string, newText: string): string {
  const lines = md.split('\n');
  let sectionIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) {
      sectionIndex += 1;
      continue;
    }
    const m = line.match(/^([\s]*)([-*])\s+(.*)$/);
    if (!m) continue;
    const [, leading, glyph, body] = m;
    const id = bulletIdFor(body.trim(), Math.max(0, sectionIndex));
    if (id === bulletId) {
      lines[i] = `${leading}${glyph} ${newText.trim()}`;
      return lines.join('\n');
    }
  }
  return md;
}
