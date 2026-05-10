/**
 * docxRenderer.test.ts
 *
 * Tests for the markdown -> styled .docx Blob renderer.
 *
 * Approach: render markdown to a Blob, then unzip the .docx (it's a zip of
 * XML files) with JSZip and assert against the underlying XML using substring
 * matches.  We deliberately avoid asserting exact XML structure — too brittle.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderResumeAsDocx } from '../../src/lib/docxRenderer';

const FIXTURE_PATH = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'sample-resume-corporate.md');

const SAMPLE_MD = readFileSync(FIXTURE_PATH, 'utf-8');

/** Helper: render to Blob, unzip, return the content of word/document.xml as a string. */
async function renderAndGetDocumentXml(
  markdown: string,
  style: 'corporate' | 'academic',
): Promise<string> {
  const blob = await renderResumeAsDocx(markdown, { style });
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('word/document.xml not found in DOCX zip');
  return docXmlFile.async('string');
}

/** Helper: render and return both document.xml and numbering.xml content. */
async function renderAndGetXml(
  markdown: string,
  style: 'corporate' | 'academic',
): Promise<{ doc: string; numbering: string | null; styles: string | null }> {
  const blob = await renderResumeAsDocx(markdown, { style });
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('word/document.xml not found');
  const doc = await docXmlFile.async('string');
  const numbering = await zip.file('word/numbering.xml')?.async('string') ?? null;
  const styles = await zip.file('word/styles.xml')?.async('string') ?? null;
  return { doc, numbering, styles };
}

describe('renderResumeAsDocx', () => {
  let corporateBlob: Blob;
  let corporateXml: string;
  let academicBlob: Blob;
  let academicXml: string;

  beforeAll(async () => {
    corporateBlob = await renderResumeAsDocx(SAMPLE_MD, { style: 'corporate' });
    academicBlob = await renderResumeAsDocx(SAMPLE_MD, { style: 'academic' });
    corporateXml = await renderAndGetDocumentXml(SAMPLE_MD, 'corporate');
    academicXml = await renderAndGetDocumentXml(SAMPLE_MD, 'academic');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T1: returns a non-empty Blob with type matching DOCX
  // ─────────────────────────────────────────────────────────────────────────
  it('T1: returns a non-empty Blob with DOCX MIME type', async () => {
    expect(corporateBlob).toBeInstanceOf(Blob);
    expect(corporateBlob.size).toBeGreaterThan(1000); // a real .docx is > 1KB
    // docx library emits the standard DOCX content-type
    expect(corporateBlob.type).toMatch(/wordprocessingml|officedocument|application\/zip/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T2: corporate style — produced .docx is parseable by JSZip and contains
  //     expected XML structure
  // ─────────────────────────────────────────────────────────────────────────
  it('T2: corporate .docx is a valid zip with word/document.xml', async () => {
    const buf = await corporateBlob.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    // Body must contain at least one paragraph
    expect(corporateXml).toContain('<w:body>');
    expect(corporateXml).toMatch(/<w:p[\s>]/);
    // Calibri font shows up somewhere
    expect(corporateXml).toContain('Calibri');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T3: academic style — similar smoke test, with serif font
  // ─────────────────────────────────────────────────────────────────────────
  it('T3: academic .docx renders with serif font (EB Garamond)', async () => {
    const buf = await academicBlob.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(academicXml).toContain('<w:body>');
    expect(academicXml).toMatch(/<w:p[\s>]/);
    expect(academicXml).toContain('EB Garamond');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T4: name parsing — # heading produces a centered run with the correct size
  // ─────────────────────────────────────────────────────────────────────────
  it('T4: # Name produces a centered run at the right size', async () => {
    // Corporate: 18pt = 36 half-points
    expect(corporateXml).toContain('Jordan Rivera');
    // Center alignment
    expect(corporateXml).toMatch(/<w:jc\s+w:val="center"/);
    // Size 36 (half-points)
    expect(corporateXml).toMatch(/<w:sz\s+w:val="36"/);

    // Academic: 24pt = 48 half-points
    expect(academicXml).toContain('Jordan Rivera');
    expect(academicXml).toMatch(/<w:jc\s+w:val="center"/);
    expect(academicXml).toMatch(/<w:sz\s+w:val="48"/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5: section heading — ## heading produces uppercase + border
  // ─────────────────────────────────────────────────────────────────────────
  it('T5: ## Section produces uppercase text with bottom border', async () => {
    // Heading text uppercased
    expect(corporateXml).toContain('EXPERIENCE');
    expect(corporateXml).toContain('EDUCATION');
    expect(corporateXml).toContain('SKILLS');
    // Bottom border element on heading paragraphs
    expect(corporateXml).toMatch(/<w:pBdr>[\s\S]*?<w:bottom\b/);

    expect(academicXml).toContain('EXPERIENCE');
    expect(academicXml).toMatch(/<w:pBdr>[\s\S]*?<w:bottom\b/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T6: bullet — - line produces a numbered paragraph
  // ─────────────────────────────────────────────────────────────────────────
  it('T6: - bullet line produces a paragraph wired to the bullet numbering', async () => {
    const { doc, numbering } = await renderAndGetXml(SAMPLE_MD, 'corporate');
    // The paragraph carries a numPr binding
    expect(doc).toMatch(/<w:numPr>/);
    expect(doc).toMatch(/<w:numId\b/);
    // The numbering.xml must exist and define the bullet character
    expect(numbering).not.toBeNull();
    expect(numbering!).toMatch(/<w:numbering\b/);
    // Corporate uses ● (U+25CF) — show up either as raw char or numeric entity
    expect(numbering!.includes('●') || numbering!.includes('&#9679;') || numbering!.includes('25CF'))
      .toBe(true);

    // Academic should use • (U+2022)
    const ac = await renderAndGetXml(SAMPLE_MD, 'academic');
    expect(ac.numbering).not.toBeNull();
    expect(ac.numbering!.includes('•') || ac.numbering!.includes('&#8226;') || ac.numbering!.includes('2022'))
      .toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T7: subtitle line with three segments — produces a paragraph with tab
  //     stops and three runs
  // ─────────────────────────────────────────────────────────────────────────
  it('T7: **Role** | *Tech* | Date Range produces tab-stopped paragraph', async () => {
    // Has at least one tab stop element with right alignment
    expect(corporateXml).toMatch(/<w:tabs>[\s\S]*?<w:tab\b[^>]*w:val="right"/);
    // Each segment appears in the run text
    expect(corporateXml).toContain('Senior Software Engineer'); // bold role
    expect(corporateXml).toContain('Go, gRPC, Kubernetes');     // italic tech
    expect(corporateXml).toContain('Mar 2022 - Present');       // date
    // Tab character run between role/tech and date
    expect(corporateXml).toMatch(/<w:tab\s*\/>/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T8: inline bold — **text** in a regular paragraph produces a bold run
  // ─────────────────────────────────────────────────────────────────────────
  it('T8: inline **bold** produces a bold run', async () => {
    const md = '# Test\n\nThis is **important** text.\n';
    const xml = await renderAndGetDocumentXml(md, 'corporate');
    // Some run must have <w:b/> and contain the word "important"
    // Find a run that contains "important" and ensure it has w:b
    const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
    const runs = xml.match(runRegex) ?? [];
    const importantRun = runs.find((r) => r.includes('>important<') || r.includes('>important '));
    expect(importantRun, 'expected a run containing "important"').toBeTruthy();
    expect(importantRun!).toMatch(/<w:b\s*\/>|<w:b\s+w:val="true"/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T9: inline italic — *text* produces an italic run
  // ─────────────────────────────────────────────────────────────────────────
  it('T9: inline *italic* produces an italics run', async () => {
    const md = '# Test\n\nThis is *fancy* text.\n';
    const xml = await renderAndGetDocumentXml(md, 'corporate');
    const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
    const runs = xml.match(runRegex) ?? [];
    const italicRun = runs.find((r) => r.includes('>fancy<') || r.includes('>fancy '));
    expect(italicRun, 'expected a run containing "fancy"').toBeTruthy();
    expect(italicRun!).toMatch(/<w:i\s*\/>|<w:i\s+w:val="true"/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T10: empty markdown — returns valid empty .docx (no errors)
  // ─────────────────────────────────────────────────────────────────────────
  it('T10: empty markdown yields a valid (small) .docx', async () => {
    const blob = await renderResumeAsDocx('', { style: 'corporate' });
    expect(blob.size).toBeGreaterThan(500); // empty docx still has overhead
    const buf = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:body>');
    // No throw is the main guarantee
  });
});
