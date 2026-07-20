import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseUploadSource,
  isConversionCacheValid,
  makeJaketexPdfConverter,
  metaPathForPdf,
  pdfPathForJob,
} from '../src/convert-pdf.ts';

const md = ['# Jane Doe', '', '## Experience', '**Engineer** Acme | 2024', '- first', '- second', ''].join('\n');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'convert-cache-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeValidCache(mdPath: string, outPdf: string): void {
  writeFileSync(outPdf, 'fake pdf bytes');
  const meta = {
    srcSha256: createHash('sha256').update(readFileSync(mdPath, 'utf8')).digest('hex'),
    droppedBullets: 0,
    pageCount: 1,
    renderer: 'jaketex',
    renderedAt: new Date().toISOString(),
  };
  writeFileSync(metaPathForPdf(outPdf), `${JSON.stringify(meta, null, 2)}\n`);
}

function makeCountingConverter(outPdf: string): { converter: ReturnType<typeof makeJaketexPdfConverter>; renders: () => number } {
  let tectonicRuns = 0;
  const converter = makeJaketexPdfConverter({
    exec: async (cmd) => {
      if (cmd === 'tectonic') {
        tectonicRuns++;
        writeFileSync(outPdf, 'fake pdf bytes');
      }
    },
    pageCount: () => 1,
  });
  return { converter, renders: () => tectonicRuns };
}

describe('conversion cache', () => {
  it('skips the render entirely when the sidecar matches the current source', async () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    const { converter, renders } = makeCountingConverter(outPdf);

    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(1);
    const metaAfterFirst = readFileSync(metaPathForPdf(outPdf), 'utf8');

    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(1);
    expect(readFileSync(metaPathForPdf(outPdf), 'utf8')).toBe(metaAfterFirst);
  });

  it('re-renders when the source markdown changes', async () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    const { converter, renders } = makeCountingConverter(outPdf);

    await converter.convert(mdPath, outPdf);
    writeFileSync(mdPath, `${md}\nUpdated line.\n`);
    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(2);

    const meta = JSON.parse(readFileSync(metaPathForPdf(outPdf), 'utf8')) as Record<string, unknown>;
    expect(meta['srcSha256']).toBe(
      createHash('sha256').update(readFileSync(mdPath, 'utf8')).digest('hex'),
    );
  });

  it('re-renders when the output PDF is missing', async () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    const { converter, renders } = makeCountingConverter(outPdf);

    await converter.convert(mdPath, outPdf);
    unlinkSync(outPdf);
    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(2);
  });

  it('ignores a sidecar with a different renderer', async () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    writeValidCache(mdPath, outPdf);
    const metaPath = metaPathForPdf(outPdf);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(metaPath, JSON.stringify({ ...meta, renderer: 'other' }));

    const { converter, renders } = makeCountingConverter(outPdf);
    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(1);
  });

  it('ignores a corrupt sidecar', async () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    writeFileSync(outPdf, 'fake pdf bytes');
    writeFileSync(metaPathForPdf(outPdf), 'not json');

    const { converter, renders } = makeCountingConverter(outPdf);
    await converter.convert(mdPath, outPdf);
    expect(renders()).toBe(1);
  });
});

describe('isConversionCacheValid', () => {
  it('is true only when pdf, matching sidecar, and source all line up', () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    expect(isConversionCacheValid(mdPath, outPdf)).toBe(false);
    writeValidCache(mdPath, outPdf);
    expect(isConversionCacheValid(mdPath, outPdf)).toBe(true);
    writeFileSync(mdPath, `${md}changed`);
    expect(isConversionCacheValid(mdPath, outPdf)).toBe(false);
  });

  it('is false when the source markdown cannot be read', () => {
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    writeValidCache(mdPath, outPdf);
    unlinkSync(mdPath);
    expect(isConversionCacheValid(mdPath, outPdf)).toBe(false);
  });
});

describe('chooseUploadSource', () => {
  function setup(files: { cache?: boolean; onepage?: boolean; sibling?: boolean }): string {
    const mdPath = join(dir, 'resume.v1.md');
    writeFileSync(mdPath, md);
    if (files.cache === true) writeValidCache(mdPath, pdfPathForJob(dir));
    if (files.onepage === true) writeFileSync(join(dir, 'resume.onepage.pdf'), 'fake');
    if (files.sibling === true) writeFileSync(join(dir, 'resume.v1.pdf'), 'fake');
    return mdPath;
  }

  it('prefers a cache-valid resume.autoapply.pdf over everything', () => {
    const mdPath = setup({ cache: true, onepage: true, sibling: true });
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 1 });
    expect(source).toEqual({ kind: 'cached', path: pdfPathForJob(dir) });
  });

  it('prefers a one-page resume.onepage.pdf over the sibling pdf', () => {
    const mdPath = setup({ onepage: true, sibling: true });
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 1 });
    expect(source).toEqual({ kind: 'onepage', path: join(dir, 'resume.onepage.pdf') });
  });

  it('rejects resume.onepage.pdf when it has more than one page', () => {
    const mdPath = setup({ onepage: true, sibling: true });
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 2 });
    expect(source).toEqual({ kind: 'sibling', path: join(dir, 'resume.v1.pdf') });
  });

  it('rejects resume.onepage.pdf when the page count cannot be verified', () => {
    const mdPath = setup({ onepage: true });
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => null });
    expect(source).toEqual({ kind: 'convert', path: pdfPathForJob(dir) });
  });

  it('falls back to the sibling resume.vN.pdf', () => {
    const mdPath = setup({ sibling: true });
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 1 });
    expect(source).toEqual({ kind: 'sibling', path: join(dir, 'resume.v1.pdf') });
  });

  it('falls back to conversion when nothing pre-built exists', () => {
    const mdPath = setup({});
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 1 });
    expect(source).toEqual({ kind: 'convert', path: pdfPathForJob(dir) });
  });

  it('ignores a stale cache and still honors the onepage pdf', () => {
    const mdPath = setup({ cache: true, onepage: true });
    writeFileSync(mdPath, `${md}changed`);
    const source = chooseUploadSource(dir, mdPath, { pageCount: () => 1 });
    expect(source).toEqual({ kind: 'onepage', path: join(dir, 'resume.onepage.pdf') });
  });
});
