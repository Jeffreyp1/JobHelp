/**
 * docxRenderer.ts
 *
 * Browser-side DOCX renderer for JobHelp resumes.  Takes the markdown
 * produced by the generate pipeline and emits a styled .docx Blob using the
 * `docx` library (https://github.com/dolanmiu/docx).  Two style profiles
 * (corporate / academic) match the project's two reference templates.
 *
 * This path runs alongside the existing Apps-Script `convertDocAs` flow —
 * we use it when we need fidelity that Google Docs export can't reproduce
 * (small-caps-style headings, custom tab stops, exact bullet glyphs, etc.).
 *
 * Markdown structure expected:
 *   # Name                                  -> centered, large
 *   contact line right after the name       -> centered, body
 *   ## Section                              -> uppercase heading w/ rule
 *   **Role** | *Tech* | Date Range          -> 3-segment subtitle (right-aligned date via tab)
 *   plain paragraph
 *   - bullet text                           -> bullet list item
 *
 * Inline ** ** => bold, * * => italic, applied recursively per-line.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ParagraphChild,
  Tab,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ResumeStyle = 'corporate' | 'academic';

export interface DocxRenderOptions {
  style: ResumeStyle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Style profiles
//
// Sizes are in DOCX "half-points" — i.e. 22 = 11pt, 36 = 18pt, 48 = 24pt.
// Margins are in twips — 1440 twips = 1 inch.
// ─────────────────────────────────────────────────────────────────────────────

interface StyleProfile {
  font: string;
  fontFallbacks?: readonly string[];
  nameSize: number;
  bodySize: number;
  sectionHeadingSize: number;
  bulletGlyph: string;
  margins: { top: number; bottom: number; left: number; right: number };
  paragraphSpacing: { before: number; after: number };
  headingSpacing: { before: number; after: number };
}

const CORPORATE: StyleProfile = {
  font: 'Calibri',
  nameSize: 36, // 18pt
  bodySize: 22, // 11pt
  sectionHeadingSize: 22, // 11pt
  bulletGlyph: '●', // ●
  margins: { top: 720, bottom: 720, left: 1080, right: 1080 }, // 0.5" / 0.75"
  paragraphSpacing: { before: 100, after: 100 },
  headingSpacing: { before: 200, after: 60 },
};

const ACADEMIC: StyleProfile = {
  font: 'EB Garamond',
  fontFallbacks: ['Garamond', 'Cambria', 'Times New Roman'],
  nameSize: 48, // 24pt
  bodySize: 22, // 11pt
  sectionHeadingSize: 20, // 10pt
  bulletGlyph: '•', // •
  margins: { top: 720, bottom: 720, left: 720, right: 720 }, // 0.5" all sides
  paragraphSpacing: { before: 60, after: 60 },
  headingSpacing: { before: 160, after: 40 },
};

function profileFor(style: ResumeStyle): StyleProfile {
  return style === 'academic' ? ACADEMIC : CORPORATE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline formatting parser
//
// We honor **bold** and *italic* anywhere in a line, including nested
// combinations like ***bold italic***.  Tokenization is greedy left-to-right
// over a small grammar — sufficient for the markdown we control.
// ─────────────────────────────────────────────────────────────────────────────

interface InlineSeg {
  text: string;
  bold: boolean;
  italic: boolean;
}

function parseInline(line: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let i = 0;
  let bold = false;
  let italic = false;
  let buf = '';

  const flush = () => {
    if (buf.length > 0) {
      segs.push({ text: buf, bold, italic });
      buf = '';
    }
  };

  while (i < line.length) {
    // ** => toggle bold (must check before single * for italic)
    if (line[i] === '*' && line[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    // * => toggle italic
    if (line[i] === '*') {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    buf += line[i];
    i += 1;
  }
  flush();
  return segs;
}

/**
 * Convert inline segments into TextRuns with the profile's body font and size.
 * Optional overrides let callers force bold/italic on top of inline parsing
 * (e.g. when the whole paragraph should be italic).
 */
function segsToRuns(
  segs: InlineSeg[],
  profile: StyleProfile,
  overrides: { bold?: boolean; italics?: boolean; size?: number; allCaps?: boolean } = {},
): TextRun[] {
  return segs.map((s) => {
    const text = overrides.allCaps ? s.text.toUpperCase() : s.text;
    return new TextRun({
      text,
      bold: overrides.bold ?? s.bold,
      italics: overrides.italics ?? s.italic,
      font: profile.font,
      size: overrides.size ?? profile.bodySize,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Subtitle parser
//
// Accepts patterns like:
//   **Senior Software Engineer** Acme Cloud Inc | *Go, gRPC, Kubernetes* | Mar 2022 - Present
//   **Senior Software Engineer** | *Go, Rust* | Mar 2022 - Present
//   **bright-rate** | *Go, Redis* | Open source
//   **Title** | Date
//   **Title** alone
// We split on " | " and assume the last segment is the date when there are 3.
// ─────────────────────────────────────────────────────────────────────────────

interface SubtitleParts {
  title: string;        // text inside the first **...** plus trailing plain text before the first |
  middle?: string;      // text inside *...* (may also be plain) of the 2nd segment
  middleItalic: boolean; // whether the 2nd segment was wrapped in * *
  date?: string;
}

function tryParseSubtitle(line: string): SubtitleParts | null {
  // Must start with **...** (the bold role/title)
  const titleMatch = line.match(/^\*\*([^*]+)\*\*(.*)$/);
  if (!titleMatch) return null;

  const titleBold = titleMatch[1];
  const tail = titleMatch[2];

  // Split the tail on " | "
  const segments = tail.split(/\s*\|\s*/);
  // segments[0] is whatever came after **...** before the first |
  const titleTrailing = segments[0]?.trim() ?? '';
  const restSegments = segments.slice(1).filter((s) => s.length > 0);

  const fullTitle = titleTrailing.length > 0
    ? `${titleBold} ${titleTrailing}`
    : titleBold;

  if (restSegments.length === 0) {
    // **Title** with no | — treat as bold paragraph (caller decides)
    return { title: fullTitle, middleItalic: false };
  }

  if (restSegments.length === 1) {
    // **Title** | *Tech* OR **Title** | Date — ambiguous.
    // If the only segment is wrapped in *...* treat as italic middle (no date);
    // else treat as date.
    const seg = restSegments[0];
    const italicMatch = seg.match(/^\*([^*]+)\*$/);
    if (italicMatch) {
      return { title: fullTitle, middle: italicMatch[1], middleItalic: true };
    }
    return { title: fullTitle, middleItalic: false, date: seg };
  }

  // 2+ rest segments — middle = first, date = last; ignore extra middles for now
  const middleRaw = restSegments[0];
  const date = restSegments[restSegments.length - 1];
  const italicMatch = middleRaw.match(/^\*([^*]+)\*$/);
  return {
    title: fullTitle,
    middle: italicMatch ? italicMatch[1] : middleRaw,
    middleItalic: !!italicMatch,
    date,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paragraph builders
// ─────────────────────────────────────────────────────────────────────────────

function buildName(text: string, profile: StyleProfile): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: profile.font,
        size: profile.nameSize,
      }),
    ],
  });
}

function buildContact(text: string, profile: StyleProfile): Paragraph {
  // Apply inline formatting in case the contact line contains **bold**/*italic*
  // (rare in production, but supports test markdown that uses bold inline).
  const segs = parseInline(text);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: profile.paragraphSpacing.after * 2 },
    children: segsToRuns(segs, profile),
  });
}

function buildSectionHeading(text: string, profile: StyleProfile): Paragraph {
  return new Paragraph({
    spacing: profile.headingSpacing,
    border: {
      bottom: {
        color: '000000',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        font: profile.font,
        size: profile.sectionHeadingSize,
      }),
    ],
  });
}

function buildSubtitle(parts: SubtitleParts, profile: StyleProfile): Paragraph {
  const children: ParagraphChild[] = [];

  // Bold title
  children.push(
    new TextRun({
      text: parts.title,
      bold: true,
      font: profile.font,
      size: profile.bodySize,
    }),
  );

  // Middle segment (italic tech / location)
  if (parts.middle) {
    children.push(
      new TextRun({ text: ' | ', font: profile.font, size: profile.bodySize }),
      new TextRun({
        text: parts.middle,
        italics: parts.middleItalic,
        font: profile.font,
        size: profile.bodySize,
      }),
    );
  }

  // Date — right-aligned via tab stop.  Use the docx `Tab` element (renders
  // as `<w:tab/>`) inside a TextRun rather than a literal '\t' character —
  // Word recognizes the explicit element when honoring the paragraph's
  // tabStops definition.
  if (parts.date) {
    children.push(
      new TextRun({
        children: [new Tab()],
        font: profile.font,
        size: profile.bodySize,
      }),
      new TextRun({
        text: parts.date,
        font: profile.font,
        size: profile.bodySize,
      }),
    );
    return new Paragraph({
      spacing: profile.paragraphSpacing,
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children,
    });
  }

  return new Paragraph({
    spacing: profile.paragraphSpacing,
    children,
  });
}

function buildBoldOnly(text: string, profile: StyleProfile): Paragraph {
  return new Paragraph({
    spacing: profile.paragraphSpacing,
    children: [
      new TextRun({
        text,
        bold: true,
        font: profile.font,
        size: profile.bodySize,
      }),
    ],
  });
}

function buildPlainParagraph(line: string, profile: StyleProfile): Paragraph {
  const segs = parseInline(line);
  return new Paragraph({
    spacing: profile.paragraphSpacing,
    children: segsToRuns(segs, profile),
  });
}

function buildBullet(line: string, profile: StyleProfile): Paragraph {
  const segs = parseInline(line);
  return new Paragraph({
    spacing: profile.paragraphSpacing,
    numbering: { reference: 'jh-bullet-list', level: 0 },
    children: segsToRuns(segs, profile),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown line classifier + main render
// ─────────────────────────────────────────────────────────────────────────────

function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

function isBulletLine(s: string): boolean {
  return /^\s*[-*]\s+/.test(s);
}

function stripBullet(s: string): string {
  return s.replace(/^\s*[-*]\s+/, '');
}

/**
 * Render the resume markdown to a styled .docx Blob.
 *
 * Browser- and Node-safe: uses `docx`'s `Packer.toBlob()` which works in both
 * environments (returns a real `Blob` in browsers and a Blob polyfill in Node
 * via the library's internals).
 */
export async function renderResumeAsDocx(
  markdown: string,
  options: DocxRenderOptions,
): Promise<Blob> {
  const profile = profileFor(options.style);
  const lines = markdown.split(/\r?\n/);

  const paragraphs: Paragraph[] = [];

  // Track whether we've consumed the name + contact line at the top.
  let nameSeen = false;
  let contactSeen = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Blank line — emit an empty spacing paragraph (Word renders this as a
    // visual gap, but our paragraph spacing already handles most of it; we
    // still emit a small empty paragraph so explicit blank lines in source
    // round-trip visually).
    if (isBlank(line)) {
      // Skip leading blanks; once we have content, emit a tiny gap paragraph.
      if (paragraphs.length === 0) continue;
      // Only emit one gap per run of blanks
      const last = paragraphs[paragraphs.length - 1];
      // Detect placeholder: nothing else useful — keep things simple by always emitting
      paragraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new TextRun({ text: '', font: profile.font, size: profile.bodySize }),
          ],
        }),
      );
      continue;
    }

    // # Name — only the first H1 is treated as the name
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match && !nameSeen) {
      nameSeen = true;
      paragraphs.push(buildName(h1Match[1].trim(), profile));
      continue;
    }

    // ## Section heading
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      paragraphs.push(buildSectionHeading(h2Match[1].trim(), profile));
      // Once we hit any section, we're past the contact line
      contactSeen = true;
      continue;
    }

    // The first non-blank, non-heading line right after the name = contact line
    if (nameSeen && !contactSeen) {
      contactSeen = true;
      paragraphs.push(buildContact(line.trim(), profile));
      continue;
    }

    // Bullet
    if (isBulletLine(line)) {
      paragraphs.push(buildBullet(stripBullet(line).trim(), profile));
      continue;
    }

    // Subtitle pattern: starts with **...**
    if (/^\*\*[^*]+\*\*/.test(line)) {
      const parts = tryParseSubtitle(line);
      if (parts) {
        // If only a title with no other parts, render as bold-only paragraph
        if (!parts.middle && !parts.date) {
          paragraphs.push(buildBoldOnly(parts.title, profile));
        } else {
          paragraphs.push(buildSubtitle(parts, profile));
        }
        continue;
      }
    }

    // Plain paragraph (with inline ** / * formatting)
    paragraphs.push(buildPlainParagraph(line, profile));
  }

  const doc = new Document({
    creator: 'JobHelp',
    title: 'Resume',
    styles: {
      default: {
        document: {
          run: {
            font: profile.font,
            size: profile.bodySize,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'jh-bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: profile.bulletGlyph,
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 360, hanging: 180 },
                },
                run: {
                  font: profile.font,
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: profile.margins,
          },
        },
        children: paragraphs,
      },
    ],
  });

  // We deliberately use Packer.toBlob — works in browser AND Node (the docx
  // library's Node fallback returns a Blob-compatible object using
  // `node:buffer`'s Blob class, available since Node 18).
  const blob = await Packer.toBlob(doc);
  return blob;
}
