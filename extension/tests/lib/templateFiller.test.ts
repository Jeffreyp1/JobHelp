/**
 * templateFiller.test.ts
 *
 * Tests for parseResumeMarkdown + fillResumeTemplate.
 *
 * For fillResumeTemplate we load the real template that ships in
 * `templates/engineering-resume-template.docx`, fill it with test data, then
 * unzip the result and assert on the rendered XML.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  parseResumeMarkdown,
  fillResumeTemplate,
  parseSkillsLines,
  parseEducationLines,
  parseExperienceHeader,
  extractLinks,
  type ResumeData,
} from '../../src/lib/templateFiller';

// ─────────────────────────────────────────────────────────────────────────────
// Sample markdown matching the spec
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_MD = `# Avery Singh
avery.singh@example.com | averysingh.dev | github.com/averys

## Skills
**CAD:** Siemens NX, CATIA V5, SolidWorks
**Analysis:** Thermal Desktop, Abaqus, LS-DYNA

## Experience

**Senior Mechanical Engineer** Acme Aerospace | *— Pasadena, CA* | Jun 2022 - Present
- **Led:** Owned thermal design for a 6U cubesat radiator, cutting peak temps by 18 °C.
- **Designed:** Created [interactive parts catalog](https://example.com/parts) used by 12 teams.

**Mechanical Engineer II** Brightline Robotics | *— Boulder, CO* | Jan 2021 - May 2022
- **Reduced:** Cut harness mass 22% via CFRP redesign.

## Projects

**Open-source Thermal Sim** | *github.com/avery/sim* | Open source
- Implemented FEM solver in Rust.
- 1.2k stars on GitHub.

## Education

**Caltech** – PhD in Aerospace Engineering | May 2010
**Caltech** – MS in Aerospace Engineering | June 2006
`;

// ─────────────────────────────────────────────────────────────────────────────
// parseResumeMarkdown — section / header tests
// ─────────────────────────────────────────────────────────────────────────────

describe('parseResumeMarkdown', () => {
  it('T1: extracts name and contact line from the header block', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    expect(data.name).toBe('Avery Singh');
    expect(data.contact).toContain('avery.singh@example.com');
    expect(data.contact).toContain('github.com/averys');
  });

  it('T2: parses Skills section into category/items pairs', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    expect(data.skills.length).toBeGreaterThanOrEqual(2);
    const cad = data.skills.find((s) => s.category === 'CAD');
    expect(cad).toBeDefined();
    expect(cad!.items).toContain('Siemens NX');
    const analysis = data.skills.find((s) => s.category === 'Analysis');
    expect(analysis).toBeDefined();
    expect(analysis!.items).toContain('Abaqus');
  });

  it('T3: extracts experience entries including title/company/city/state/dateRange', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    expect(data.experiences.length).toBe(2);
    const e0 = data.experiences[0];
    expect(e0.title).toBe('Senior Mechanical Engineer');
    expect(e0.company).toBe('Acme Aerospace');
    expect(e0.city).toBe('Pasadena');
    expect(e0.state).toBe('CA');
    expect(e0.dateRange).toBe('Jun 2022 - Present');
    expect(e0.bullets.length).toBe(2);
  });

  it('T4: extracts experience bullets with bold lead and rest', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    const b = data.experiences[0].bullets[0];
    expect(b.lead).toBe('Led');
    expect(b.rest).toContain('cubesat radiator');
    // Second bullet contains a markdown link → links array populated
    const b1 = data.experiences[0].bullets[1];
    expect(b1.lead).toBe('Designed');
    expect(b1.links).toEqual([
      { text: 'interactive parts catalog', url: 'https://example.com/parts' },
    ]);
    // Plain text shouldn't keep the markdown link syntax
    expect(b1.rest).not.toContain('](');
  });

  it('T5: parses Projects section header + bullets', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    expect(data.projects.length).toBe(1);
    const p = data.projects[0];
    expect(p.title).toBe('Open-source Thermal Sim');
    expect(p.rightInfo).toContain('github.com/avery/sim');
    expect(p.bullets.length).toBe(2);
    // Bullets are now objects {lead, leadSep, rest}; combine for content match
    const combined = `${p.bullets[0].lead}${p.bullets[0].leadSep}${p.bullets[0].rest}`;
    expect(combined).toMatch(/Rust/);
  });

  it('T6: parses Education section into school/degree/date triples', () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    expect(data.education.length).toBe(2);
    expect(data.education[0]).toEqual({
      school: 'Caltech',
      degree: 'PhD in Aerospace Engineering',
      date: 'May 2010',
    });
    expect(data.education[1].degree).toBe('MS in Aerospace Engineering');
  });

  it('T7: tolerates blank Skills / Projects sections without throwing', () => {
    const minimal = `# Jane Doe
jane@example.com

## Experience

**Engineer** Some Co | *— Austin, TX* | 2024-Present
- **Did:** A thing.

## Education

**MIT** – BS in CS | 2020
`;
    const data = parseResumeMarkdown(minimal);
    expect(data.skills).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.experiences.length).toBe(1);
    expect(data.education.length).toBe(1);
  });

  it('T8: parseSkillsLines handles "**Cat**: items" and bare "Cat: items"', () => {
    const groups = parseSkillsLines([
      '**Languages**: Go, Rust',
      'Tools: NX, CATIA',
      '**CAD:** SolidWorks, Inventor',
    ]);
    const langs = groups.find((g) => g.category === 'Languages');
    expect(langs?.items).toBe('Go, Rust');
    const tools = groups.find((g) => g.category === 'Tools');
    expect(tools?.items).toBe('NX, CATIA');
    const cad = groups.find((g) => g.category === 'CAD');
    expect(cad?.items).toBe('SolidWorks, Inventor');
  });

  it('T9: parseExperienceHeader handles missing city/state gracefully', () => {
    const h = parseExperienceHeader('**Lead Engineer** Acme | Jul 2018 - Present');
    expect(h?.title).toBe('Lead Engineer');
    expect(h?.company).toBe('Acme');
    expect(h?.dateRange).toBe('Jul 2018 - Present');
    // No location segment → empty city/state
    expect(h?.city).toBe('');
    expect(h?.state).toBe('');
  });

  it('T10: extractLinks pulls markdown links into a parallel array', () => {
    const r = extractLinks(
      'See [docs](https://x.com/d) and [repo](https://github.com/r) for details.',
    );
    expect(r.plain).toBe('See docs and repo for details.');
    expect(r.links).toEqual([
      { text: 'docs', url: 'https://x.com/d' },
      { text: 'repo', url: 'https://github.com/r' },
    ]);
  });

  it('T11: parseEducationLines handles single line without date pipe', () => {
    const eds = parseEducationLines(['**MIT** – BS in CS']);
    expect(eds[0]).toEqual({
      school: 'MIT',
      degree: 'BS in CS',
      date: '',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fillResumeTemplate — integration with the shipped template
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'templates',
  'engineering-resume-template.docx',
);

let templateBuf: ArrayBuffer;

beforeAll(() => {
  const buf = readFileSync(TEMPLATE_PATH);
  // Slice to ensure ArrayBuffer (not Buffer wrapping a SharedArrayBuffer).
  templateBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
});

const SMALL_DATA: ResumeData = {
  name: 'Test User',
  contact: 'test@example.com | test.dev | github.com/test',
  skills: [
    { category: 'CAD', items: 'Siemens NX, CATIA V5' },
    { category: 'Analysis', items: 'Abaqus, LS-DYNA' },
  ],
  experiences: [
    {
      title: 'Senior Engineer',
      company: 'Acme',
      city: 'Pasadena',
      state: 'CA',
      dateRange: 'Jun 2022 - Present',
      bullets: [
        { lead: 'Led', rest: 'thermal design overhaul.', links: [] },
        { lead: 'Built', rest: 'a real-time monitoring dashboard.', links: [] },
      ],
    },
  ],
  projects: [
    {
      title: 'Cool Project',
      rightInfo: 'github.com/test/cool',
      bullets: [
        { lead: '', leadSep: '', rest: 'Wrote code' },
        { lead: '', leadSep: '', rest: 'Got stars' },
      ],
    },
  ],
  education: [
    { school: 'Caltech', degree: 'PhD in Aero', date: 'May 2010' },
  ],
};

async function unzipDocumentXml(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('document.xml not found in produced .docx');
  return f.async('string');
}

describe('fillResumeTemplate', () => {
  it('T12: produces a DOCX zip containing word/document.xml', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const buf = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('word/document.xml')).not.toBeNull();
  });

  it('T13: substitutes simple placeholders (name, contact)', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('Test User');
    expect(xml).toContain('test@example.com');
    // The literal placeholder must be gone.
    expect(xml).not.toContain('{name}');
    expect(xml).not.toContain('{contact}');
  });

  it('T14: expands the {#skills} loop into one row per group', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('CAD');
    expect(xml).toContain('Siemens NX');
    expect(xml).toContain('Analysis');
    expect(xml).toContain('Abaqus');
    expect(xml).not.toContain('{#skills}');
    expect(xml).not.toContain('{/skills}');
  });

  it('T15: expands {#experiences} including nested {#bullets}', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('Senior Engineer');
    expect(xml).toContain('Acme');
    expect(xml).toContain('Pasadena');
    expect(xml).toContain('Jun 2022 - Present');
    expect(xml).toContain('thermal design overhaul');
    expect(xml).toContain('real-time monitoring dashboard');
    expect(xml).not.toContain('{#experiences}');
    expect(xml).not.toContain('{#bullets}');
  });

  it('T16: expands {#projects} with right-info and string bullets', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('Cool Project');
    expect(xml).toContain('github.com/test/cool');
    expect(xml).toContain('Wrote code');
    expect(xml).toContain('Got stars');
  });

  it('T17: expands {#education} into school/degree/date rows', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('Caltech');
    expect(xml).toContain('PhD in Aero');
    expect(xml).toContain('May 2010');
  });

  it('T18: end-to-end markdown → fill produces valid DOCX with markdown values', async () => {
    const data = parseResumeMarkdown(SAMPLE_MD);
    const blob = await fillResumeTemplate(templateBuf, data);
    const xml = await unzipDocumentXml(blob);
    expect(xml).toContain('Avery Singh');
    expect(xml).toContain('Acme Aerospace');
    expect(xml).toContain('Boulder');
    expect(xml).toContain('Caltech');
    // No unrendered loop tags should remain.
    expect(xml).not.toMatch(/\{#\w+\}/);
    expect(xml).not.toMatch(/\{\/\w+\}/);
  });

  it('T19: returned Blob has the correct DOCX MIME type', async () => {
    const blob = await fillResumeTemplate(templateBuf, SMALL_DATA);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('T20: throws a wrapped error when given non-zip bytes', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4]).buffer;
    await expect(fillResumeTemplate(garbage, SMALL_DATA)).rejects.toThrow(
      /templateFiller/,
    );
  });
});
