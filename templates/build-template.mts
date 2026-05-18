// Generates templates/engineering-resume-template.docx with docxtemplater placeholders.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Tab,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';

type RunOpts = ConstructorParameters<typeof TextRun>[0];
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const OUT_PATH = join(OUT_DIR, 'engineering-resume-template.docx');

const FONT = 'Calibri';
const NAME_SIZE = 44;
const BODY_SIZE = 20;
const HEADING_SIZE = 22;
const BULLET_GLYPH = '●';
const MARGINS = { top: 720, bottom: 720, left: 1080, right: 1080 };
const PARA_SPACING = { before: 40, after: 40 };
const HEADING_SPACING = { before: 160, after: 60 };

const run = (text: string, opts: Partial<RunOpts> = {}): TextRun =>
  new TextRun({ text, font: FONT, size: BODY_SIZE, ...opts });

const boldRun = (text: string, opts: Partial<RunOpts> = {}): TextRun => run(text, { bold: true, ...opts });

function sectionHeading(text: string): Paragraph {
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

function leftBoldRightTabPara(leftRuns: TextRun[], rightRuns: TextRun[]): Paragraph {
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

function bulletPara(children: TextRun[]): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 40 },
    indent: { left: 360, hanging: 220 },
    children: [
      new TextRun({ text: `${BULLET_GLYPH}  `, font: FONT, size: BODY_SIZE }),
      ...children,
    ],
  });
}

const paragraphs: Paragraph[] = [];

paragraphs.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({ text: '{name}', bold: true, font: FONT, size: NAME_SIZE }),
    ],
  }),
);

paragraphs.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
    children: [run('{contact}')],
  }),
);

paragraphs.push(sectionHeading('Skills'));
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

paragraphs.push(sectionHeading('Experience'));
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#experiences}')] }),
);
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

paragraphs.push(sectionHeading('Projects'));
paragraphs.push(
  new Paragraph({ spacing: PARA_SPACING, children: [run('{#projects}')] }),
);
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
