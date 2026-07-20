import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dropLastBullet,
  makeJaketexPdfConverter,
  metaPathForPdf,
  pdfPathForJob,
} from '../src/convert-pdf.ts';

describe('dropLastBullet', () => {
  it('removes only the last bullet line, preserving everything else', () => {
    const md = ['## Experience', '- first', '- second', '- third'].join('\n');
    expect(dropLastBullet(md)).toBe(['## Experience', '- first', '- second'].join('\n'));
  });

  it('never empties an entry — a sole bullet is left in place', () => {
    // Both entries have exactly one bullet, so nothing can be safely dropped.
    const md = ['**A**', '- only a', '', '**B**', '- only b'].join('\n');
    expect(dropLastBullet(md)).toBeNull();
  });

  it('drops from the bottom-most entry that has >=2 bullets, sparing single-bullet entries below', () => {
    const md = ['**A**', '- a1', '- a2', '', '**B**', '- only b'].join('\n');
    // B has one bullet (spared); A has two, so its last ("- a2") goes.
    expect(dropLastBullet(md)).toBe(['**A**', '- a1', '', '**B**', '- only b'].join('\n'));
  });

  it('recognizes "*" bullets too', () => {
    expect(dropLastBullet('* one\n* two')).toBe('* one');
  });

  it('returns null when there are no bullets to drop', () => {
    expect(dropLastBullet('# Name\n\n## Skills\n**Languages:** Python')).toBeNull();
  });

  it('ignores bold markers and headers (not treated as bullets)', () => {
    const md = '**Title** Company | *- City* | 2024\n## Section';
    expect(dropLastBullet(md)).toBeNull();
  });
});

describe('pdfPathForJob', () => {
  it('targets resume.autoapply.pdf in the job dir', () => {
    expect(pdfPathForJob('/x/y')).toBe('/x/y/resume.autoapply.pdf');
  });
});

describe('metaPathForPdf', () => {
  it('sits next to the pdf as resume.autoapply.meta.json', () => {
    expect(metaPathForPdf('/x/y/resume.autoapply.pdf')).toBe('/x/y/resume.autoapply.meta.json');
  });
});

function bulletMd(bullets: number): string {
  const lines = ['# Jane Doe', '', 'jane@doe.dev', '', '## Experience', '**Engineer** Acme | 2024'];
  for (let i = 1; i <= bullets; i++) lines.push(`- bullet ${i}`);
  lines.push('');
  return lines.join('\n');
}

function countBullets(text: string): number {
  return text.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
}

interface TrimResult {
  meta: Record<string, unknown>;
  renders: number;
  finalBullets: number;
}

/** Renders "fit on one page" iff the trimmed source has <= fitsAtOrBelow bullets. */
async function convertWithThreshold(
  opts: { bullets: number; fitsAtOrBelow: number; maxTrim?: number },
): Promise<TrimResult> {
  const dir = mkdtempSync(join(tmpdir(), 'convert-meta-'));
  try {
    const md = bulletMd(opts.bullets);
    const mdPath = join(dir, 'resume.md');
    writeFileSync(mdPath, md);
    const outPdf = pdfPathForJob(dir);
    const srcMd = outPdf.replace(/\.pdf$/, '.src.md');
    let renders = 0;
    const converter = makeJaketexPdfConverter({
      ...(opts.maxTrim !== undefined ? { maxTrim: opts.maxTrim } : {}),
      exec: async (cmd) => {
        if (cmd === 'tectonic') {
          renders++;
          writeFileSync(outPdf, 'fake pdf bytes');
        }
      },
      pageCount: () => (countBullets(readFileSync(srcMd, 'utf8')) <= opts.fitsAtOrBelow ? 1 : 2),
    });
    await converter.convert(mdPath, outPdf);
    const parsed: unknown = JSON.parse(readFileSync(metaPathForPdf(outPdf), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('meta is not an object');
    return {
      meta: parsed as Record<string, unknown>,
      renders,
      finalBullets: countBullets(readFileSync(srcMd, 'utf8')),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('conversion sidecar meta', () => {
  it('writes srcSha256, droppedBullets, pageCount, renderer, renderedAt on a clean render', async () => {
    const { meta } = await convertWithThreshold({ bullets: 3, fitsAtOrBelow: 3 });
    expect(meta['srcSha256']).toBe(createHash('sha256').update(bulletMd(3)).digest('hex'));
    expect(meta['droppedBullets']).toBe(0);
    expect(meta['pageCount']).toBe(1);
    expect(meta['renderer']).toBe('jaketex');
    expect(Number.isNaN(Date.parse(String(meta['renderedAt'])))).toBe(false);
  });

  it('records trimmed bullets while hashing the original markdown', async () => {
    const { meta } = await convertWithThreshold({ bullets: 3, fitsAtOrBelow: 1 });
    expect(meta['droppedBullets']).toBe(2);
    expect(meta['pageCount']).toBe(1);
    expect(meta['srcSha256']).toBe(createHash('sha256').update(bulletMd(3)).digest('hex'));
  });

  it('still writes meta when the page count is unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'convert-meta-'));
    try {
      const mdPath = join(dir, 'resume.md');
      writeFileSync(mdPath, bulletMd(3));
      const outPdf = pdfPathForJob(dir);
      const converter = makeJaketexPdfConverter({ exec: async () => {}, pageCount: () => null });
      await converter.convert(mdPath, outPdf);
      const meta = JSON.parse(readFileSync(metaPathForPdf(outPdf), 'utf8')) as Record<string, unknown>;
      expect(meta['pageCount']).toBeNull();
      expect(meta['droppedBullets']).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bisected trim loop', () => {
  it('finds the smallest fitting drop count, not just any fitting one', async () => {
    const { meta, finalBullets } = await convertWithThreshold({ bullets: 10, fitsAtOrBelow: 2 });
    expect(meta['droppedBullets']).toBe(8);
    expect(meta['pageCount']).toBe(1);
    expect(finalBullets).toBe(2);
  });

  it('needs O(log n) compiles instead of one per dropped bullet', async () => {
    const { renders } = await convertWithThreshold({ bullets: 10, fitsAtOrBelow: 2 });
    // old loop: 9 compiles (drops 0..8); bisect: initial + ~log2(9) probes + final re-render
    expect(renders).toBeLessThanOrEqual(6);
  });

  it('handles a single-bullet trim', async () => {
    const { meta, finalBullets } = await convertWithThreshold({ bullets: 5, fitsAtOrBelow: 4 });
    expect(meta['droppedBullets']).toBe(1);
    expect(finalBullets).toBe(4);
  });

  it('leaves the maximally-trimmed render when nothing fits', async () => {
    const { meta, finalBullets } = await convertWithThreshold({ bullets: 4, fitsAtOrBelow: 0 });
    expect(meta['droppedBullets']).toBe(3);
    expect(meta['pageCount']).toBe(2);
    expect(finalBullets).toBe(1);
  });

  it('respects maxTrim as the drop ceiling', async () => {
    const { meta, finalBullets } = await convertWithThreshold({ bullets: 10, fitsAtOrBelow: 2, maxTrim: 4 });
    expect(meta['droppedBullets']).toBe(4);
    expect(meta['pageCount']).toBe(2);
    expect(finalBullets).toBe(6);
  });
});
