/**
 * build-template.mjs
 *
 * Generates the engineering-resume-template.docx that ships with JobHelp.
 *
 * The template is a standard .docx file with docxtemplater placeholders
 * embedded as plain text — e.g. `{name}`, `{#experiences}…{/experiences}`.
 *
 * Visual formatting (bold, tab stops, bullet glyphs, line spacing) lives in
 * the run/paragraph properties around the placeholders, so when docxtemplater
 * substitutes data the result inherits the template's appearance.
 *
 * Run:
 *   node templates/build-template.mjs
 *
 * Output:
 *   templates/engineering-resume-template.docx
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const OUT_PATH = join(OUT_DIR, 'engineering-resume-template.docx');

// ─── Style profile (matches the user's screenshot) ─────────────────────────
const FONT = 'Calibri';
const NAME_SIZE = 44;          // 22pt
const BODY_SIZE = 20;          // 10pt
const HEADING_SIZE = 22;       // 11pt
const BULLET_GLYPH = '●'; // ●
const MARGINS = { top: 720, bottom: 720, left: 1080, right: 1080 };
const PARA_SPACING = { before: 40, after: 40 };
const HEADING_SPACING = { before: 160, after: 60 };

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Plain run (body size, no bold). */
const run = (text, opts = {}) =>
  new TextRun({ text, font: FONT, size: BODY_SIZE, ...opts });

/** Bold run. */
const boldRun = (text, opts = {}) => run(text, { bold: true, ...opts });

/** Section heading: bold + bottom border line. */
function sectionHeading(text) {
  return new Paragraph({
    spacing: HEADING_SPACING,
    border: {
      bottom: { color: '000000', space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    children: [
      new TextRun({ text, bold: true, font: FONT, size: HEADING_SIZE }),
    ],
  });
}

/** Right-aligned tab paragraph with leading bold + a tab + right-side text. */
function leftBoldRightTabPara(leftRuns, rightRuns) {
  return new Paragraph({
    spacing: PARA_SPACING,
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children: [
      ...leftRuns,
      new TextRun({ children: [new Tab()], font: FONT, size: BODY_SIZE }),
      ...rightRuns,
    ],
  });
}

/** Bullet paragraph using docxtemplater's loop body markup. */
function bulletPara(children) {
  return new Paragraph({
    spacing: { before: 0, after: 40 },
    indent: { left: 360, hanging: 220 },
    children: [
      new TextRun({ text: `${BULLET_GLYPH}  `, font: FONT, size: BODY_SIZE }),
      ...children,
    ],
  });
}

// ─── Build the template paragraphs in order ───────────────────────────────

const paragraphs = [];

// Name (centered, bold, large)
paragraphs.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({ text: '{name}', bold: true, font: FONT, size: NAME_SIZE }),
    ],
  }),
);

// Contact (centered)
paragraphs.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
    children: [run('{contact}')],
  }),
);

// SKILLS section
paragraphs.push(sectionHeading('Skills'));
// Loop: each skill on its own line, "**Category:** items"
paragraphs.push(
  new Paragraph({
    spacing: PARA_SPACING,
    children: [run('{#skills}')],
  }),
);
paragraphs.push(
  new Paragraph({
    spacing: PARA_SPACING,
    children: [
      boldRun('{category}:'),
      run(' {items}'),
    ],
  }),
);
paragraphs.push(
  new Paragraph({
    spacing: PARA_SPACING,
    children: [run('{/skills}')],
  }),
);

// EXPERIENCE section
paragraphs.push(sectionHeading('Experience'));
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#experiences}')] }),
);
// Header line: **Title,** Company – City, State    [tab] dateRange
paragraphs.push(
  leftBoldRightTabPara(
    [
      boldRun('{title},'),
      run(' '),
      boldRun('{company}'),
      run(' – '),
      run('{city}, {state}'),
    ],
    [run('{dateRange}')],
  ),
);
// Loop bullets: ● **{lead}:** {rest}
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#bullets}')] }),
);
paragraphs.push(
  bulletPara([boldRun('{lead}:'), run(' {rest}')]),
);
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{/bullets}')] }),
);
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{/experiences}')] }),
);

// PROJECTS section
paragraphs.push(sectionHeading('Projects'));
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#projects}')] }),
);
// Header line: **Title** — *tech stack* (inline, italic plain black)
paragraphs.push(
  new Paragraph({
    spacing: PARA_SPACING,
    children: [
      boldRun('{title}'),
      run(' — '),
      run('{rightInfo}', { italics: true }),
    ],
  }),
);
// Bullets: support **lead:** rest format like experience bullets
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#bullets}')] }),
);
paragraphs.push(
  bulletPara([
    boldRun('{lead}'),
    run('{leadSep}'),
    run('{rest}'),
  ]),
);
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{/bullets}')] }),
);
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{/projects}')] }),
);

// EDUCATION section
paragraphs.push(sectionHeading('Education'));
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#education}')] }),
);
paragraphs.push(
  leftBoldRightTabPara(
    [boldRun('{school}'), run(' – {degree}')],
    [run('{date}')],
  ),
);
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{/education}')] }),
);

// ─── Build & write document ────────────────────────────────────────────────

const doc = new Document({
  creator: 'JobHelp',
  title: 'Engineering Resume Template',
  description:
    'docxtemplater-compatible template. Loops use {#name}…{/name}; '
      + 'simple placeholders use {name}.',
  styles: {
    default: {
      document: {
        run: { font: FONT, size: BODY_SIZE },
      },
    },
  },
  sections: [
    {
      properties: { page: { margin: MARGINS } },
      children: paragraphs,
    },
  ],
});

mkdirSync(OUT_DIR, { recursive: true });

const buffer = await Packer.toBuffer(doc);
writeFileSync(OUT_PATH, buffer);

console.log(`Wrote ${OUT_PATH} (${(buffer.length / 1024).toFixed(1)} KB)`);
