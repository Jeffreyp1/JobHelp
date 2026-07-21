import { readFileSync, writeFileSync } from 'node:fs';
import {
  Document, Paragraph, TextRun, AlignmentType, BorderStyle,
  TabStopType, LevelFormat, Packer, UnderlineType, convertInchesToTwip,
} from 'docx';

const [, , inPath, outPath, fontArg] = process.argv;
const md = readFileSync(inPath, 'utf8');

// Default Cambria (renders everywhere). Pass a 3rd arg or RESUME_FONT to match LaTeX's
// look — e.g. "CMU Serif" or "Latin Modern Roman" (must be installed in your Word/system).
const FONT = fontArg || process.env.RESUME_FONT || 'Cambria';
const NAME_SIZE = 48;        // 24pt
const CONTACT_SIZE = 22;     // 11pt
const SECTION_SIZE = 26;     // 13pt
const BODY_SIZE = 22;        // 11pt
const SUB_SIZE = 21;         // 10.5pt
const BULLET_SIZE = 21;      // 10.5pt
const RIGHT_TAB = convertInchesToTwip(7.5); // matches 0.5" margins on 8.5" paper

type Section = { name: string; lines: string[] };

function splitSections(text: string): { header: string[]; sections: Map<string, string[]> } {
  const lines = text.split(/\r?\n/);
  const header: string[] = [];
  const sections = new Map<string, string[]>();
  let cur: Section | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (cur) sections.set(cur.name.toLowerCase(), cur.lines);
      cur = { name: h2[1].trim(), lines: [] };
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) { header.push(h1[1].trim()); continue; }
    if (cur) cur.lines.push(line);
    else if (line.trim()) header.push(line.trim());
  }
  if (cur) sections.set(cur.name.toLowerCase(), cur.lines);
  return { header, sections };
}

// Parse a line with **bold** and *italic* markers into TextRun children.
// Supports nested-free segments. Italics inside bold not specially handled
// (resume markdown rarely needs it).
function inlineRuns(text: string, base: { font: string; size: number; italics?: boolean }): TextRun[] {
  const out: TextRun[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push(new TextRun({ ...base, text: text.slice(lastIndex, m.index) }));
    }
    if (m[1] !== undefined) {
      out.push(new TextRun({ ...base, text: m[1], bold: true }));
    } else {
      out.push(new TextRun({ ...base, text: m[2], italics: true }));
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push(new TextRun({ ...base, text: text.slice(lastIndex) }));
  }
  return out;
}

function sectionHeading(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 60 },
    border: { bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 2 } },
    children: [
      new TextRun({ font: FONT, text: label, smallCaps: true, bold: true, size: SECTION_SIZE }),
    ],
  });
}

function nameParagraph(name: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 40 },
    children: [new TextRun({ font: FONT, text: name, bold: true, size: NAME_SIZE })],
  });
}

function contactParagraph(line: string): Paragraph {
  const parts = line.split('|').map(s => s.trim()).filter(Boolean);
  const children: TextRun[] = [];
  parts.forEach((part, i) => {
    if (i > 0) children.push(new TextRun({ font: FONT, text: ' | ', size: CONTACT_SIZE }));
    const isLink = /@|linkedin\.|github\.|http|\.com|\.io/i.test(part);
    children.push(new TextRun({
      font: FONT, text: part, size: CONTACT_SIZE,
      underline: isLink ? { type: UnderlineType.SINGLE } : undefined,
    }));
  });
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
    children,
  });
}

// Skills line like "**Category:** items text with **bold** parts"
function skillsParagraph(line: string): Paragraph | null {
  const m = line.match(/^\*\*([^*]+?):\*\*\s*(.+)$/);
  if (!m) return null;
  return new Paragraph({
    indent: { left: 220 },
    spacing: { before: 0, after: 30 },
    children: [
      new TextRun({ font: FONT, text: `${m[1]}: `, bold: true, size: BULLET_SIZE }),
      ...inlineRuns(m[2], { font: FONT, size: BULLET_SIZE }),
    ],
  });
}

// Experience header: "**Title** Company | *- City, ST* | Date"
function experienceHeaderParagraphs(line: string): Paragraph[] {
  const m = line.match(/^\*\*([^*]+)\*\*\s+(.+?)\s*\|\s*\*-?\s*([^*]+?)\*\s*\|\s*(.+)$/);
  if (!m) return [];
  const [, title, company, loc, date] = m;
  return [
    new Paragraph({
      spacing: { before: 120, after: 0 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ font: FONT, text: title, bold: true, size: BODY_SIZE }),
        new TextRun({ font: FONT, text: '\t', size: BODY_SIZE }),
        new TextRun({ font: FONT, text: date, size: BODY_SIZE }),
      ],
    }),
    new Paragraph({
      spacing: { before: 0, after: 40 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ font: FONT, text: company, italics: true, size: SUB_SIZE }),
        new TextRun({ font: FONT, text: '\t', size: SUB_SIZE }),
        new TextRun({ font: FONT, text: loc.trim(), italics: true, size: SUB_SIZE }),
      ],
    }),
  ];
}

// Project header: "**Title**" or "**Title** | *url*"
function projectHeaderParagraph(line: string): Paragraph | null {
  const m = line.match(/^\*\*([^*]+)\*\*(?:\s*\|\s*\*([^*]+)\*)?$/);
  if (!m) return null;
  const children: TextRun[] = [
    new TextRun({ font: FONT, text: m[1], bold: true, size: BODY_SIZE }),
  ];
  if (m[2]) {
    children.push(new TextRun({ font: FONT, text: '   ', size: SUB_SIZE }));
    children.push(new TextRun({ font: FONT, text: m[2], italics: true, size: SUB_SIZE }));
  }
  return new Paragraph({
    spacing: { before: 100, after: 40 },
    children,
  });
}

// Education line: "**School** – Degree | Date"
function educationParagraphs(line: string): Paragraph[] {
  // Match school, then optional "– Degree", and optional "| Date"
  const m = line.match(/^\*\*([^*]+)\*\*(?:\s*[–-]\s*(.+?))?(?:\s*\|\s*(.+))?$/);
  if (!m) return [];
  const [, school, degree, date] = m;
  return [
    new Paragraph({
      spacing: { before: 80, after: 0 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ font: FONT, text: school, bold: true, size: BODY_SIZE }),
        new TextRun({ font: FONT, text: '\t', size: BODY_SIZE }),
        new TextRun({ font: FONT, text: date ?? '', size: BODY_SIZE }),
      ],
    }),
    ...(degree ? [new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ font: FONT, text: degree, italics: true, size: SUB_SIZE })],
    })] : []),
  ];
}

function bulletParagraph(text: string): Paragraph {
  // Strip leading "- " from raw markdown bullet
  const body = text.replace(/^\s*[-*]\s+/, '');
  // "**Lead:** rest" — bold lead + plain rest, with possible inner **bold** segments
  const leadMatch = body.match(/^\*\*([^*]+?):\*\*\s*(.+)$/);
  let children: TextRun[];
  if (leadMatch) {
    children = [
      new TextRun({ font: FONT, text: `${leadMatch[1]}: `, bold: true, size: BULLET_SIZE }),
      ...inlineRuns(leadMatch[2], { font: FONT, size: BULLET_SIZE }),
    ];
  } else {
    children = inlineRuns(body, { font: FONT, size: BULLET_SIZE });
  }
  return new Paragraph({
    numbering: { reference: 'jh-bullets', level: 0 },
    spacing: { before: 0, after: 20 },
    children,
  });
}

const { header, sections } = splitSections(md);
const name = header[0] ?? '';
const contact = header[1] ?? '';

const paragraphs: Paragraph[] = [];
paragraphs.push(nameParagraph(name));
if (contact) paragraphs.push(contactParagraph(contact));

function renderSkills(lines: string[]) {
  paragraphs.push(sectionHeading('Technical Skills'));
  for (const l of lines) {
    if (!l.trim()) continue;
    const p = skillsParagraph(l);
    if (p) paragraphs.push(p);
  }
}

function renderExperienceLike(lines: string[], title: string, isProjects = false) {
  paragraphs.push(sectionHeading(title));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (isProjects) {
      const ph = projectHeaderParagraph(line.trim());
      if (ph) paragraphs.push(ph);
    } else {
      const eh = experienceHeaderParagraphs(line.trim());
      eh.forEach(p => paragraphs.push(p));
    }
    i++;
    while (i < lines.length && lines[i].trim().startsWith('-')) {
      paragraphs.push(bulletParagraph(lines[i]));
      i++;
    }
  }
}

function renderEducation(lines: string[]) {
  paragraphs.push(sectionHeading('Education'));
  for (const l of lines) {
    if (!l.trim()) continue;
    educationParagraphs(l.trim()).forEach(p => paragraphs.push(p));
  }
}

if (sections.has('skills')) renderSkills(sections.get('skills')!);
if (sections.has('experience')) renderExperienceLike(sections.get('experience')!, 'Relevant Experience', false);
if (sections.has('projects')) renderExperienceLike(sections.get('projects')!, 'Projects', true);
if (sections.has('education')) renderEducation(sections.get('education')!);

const doc = new Document({
  creator: 'JobHelp',
  title: 'Resume',
  styles: {
    default: {
      document: { run: { font: FONT, size: BODY_SIZE } },
    },
  },
  numbering: {
    config: [{
      reference: 'jh-bullets',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 220 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(0.5),
          bottom: convertInchesToTwip(0.5),
          left: convertInchesToTwip(0.5),
          right: convertInchesToTwip(0.5),
        },
      },
    },
    children: paragraphs,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes)`);
