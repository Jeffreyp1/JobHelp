import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot } from './paths.ts';
import { log } from './log.ts';
import type { ResumeConverter } from './convert.ts';

/** Upload slot for the engine-rendered Jake-style PDF. */
export function pdfPathForJob(dir: string): string {
  return join(dir, 'resume.autoapply.pdf');
}

export function jaketexScriptPath(): string {
  return join(repoRoot(), 'scripts', 'render-jaketex.mts');
}

/**
 * Sidecar written next to every rendered PDF. `srcSha256` hashes the ORIGINAL
 * source markdown (pre-trim), so { srcSha256, renderer } can double as a
 * conversion cache key later.
 */
export interface ConversionMeta {
  srcSha256: string;
  droppedBullets: number;
  pageCount: number | null;
  renderer: 'jaketex';
  renderedAt: string;
}

export function metaPathForPdf(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '.meta.json');
}

function readConversionMeta(pdfPath: string): ConversionMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metaPathForPdf(pdfPath), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (typeof m['srcSha256'] !== 'string' || typeof m['droppedBullets'] !== 'number') return null;
  if (m['renderer'] !== 'jaketex' || typeof m['renderedAt'] !== 'string') return null;
  return {
    srcSha256: m['srcSha256'],
    droppedBullets: m['droppedBullets'],
    pageCount: typeof m['pageCount'] === 'number' ? m['pageCount'] : null,
    renderer: 'jaketex',
    renderedAt: m['renderedAt'],
  };
}

function cacheHit(srcSha256: string, outPdfPath: string): boolean {
  if (!existsSync(outPdfPath)) return false;
  const meta = readConversionMeta(outPdfPath);
  return meta !== null && meta.srcSha256 === srcSha256;
}

/** True when outPdfPath was rendered from mdPath's current content (per the sidecar). */
export function isConversionCacheValid(mdPath: string, outPdfPath: string): boolean {
  let src: string;
  try {
    src = readFileSync(mdPath, 'utf8');
  } catch {
    return false;
  }
  return cacheHit(createHash('sha256').update(src).digest('hex'), outPdfPath);
}

export type UploadSource =
  | { kind: 'cached'; path: string }
  | { kind: 'onepage'; path: string }
  | { kind: 'sibling'; path: string }
  | { kind: 'convert'; path: string };

/**
 * Pick the resume PDF to upload without paying for a render when one already
 * exists: cache-valid resume.autoapply.pdf > curated resume.onepage.pdf
 * (only if verifiably one page) > sibling resume.vN.pdf > convert.
 */
export function chooseUploadSource(
  dir: string,
  resumeMdPath: string,
  opts: { pageCount?: (pdfPath: string) => number | null } = {},
): UploadSource {
  const countPages = opts.pageCount ?? pdfPageCount;
  const autoapplyPdf = pdfPathForJob(dir);
  if (isConversionCacheValid(resumeMdPath, autoapplyPdf)) {
    return { kind: 'cached', path: autoapplyPdf };
  }
  const onepagePdf = join(dir, 'resume.onepage.pdf');
  if (existsSync(onepagePdf)) {
    const pages = countPages(onepagePdf);
    if (pages !== null && pages <= 1) return { kind: 'onepage', path: onepagePdf };
  }
  const siblingPdf = resumeMdPath.replace(/\.md$/, '.pdf');
  if (existsSync(siblingPdf)) return { kind: 'sibling', path: siblingPdf };
  return { kind: 'convert', path: autoapplyPdf };
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code ?? 'null'}`))));
  });
}

/** Page count via pdfinfo, or null if pdfinfo is unavailable/unparseable. */
export function pdfPageCount(pdfPath: string): number | null {
  try {
    const out = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Drop one resume bullet to shrink the document, returning the trimmed markdown
 * or null when nothing can be safely dropped. Pure.
 *
 * It removes the last bullet of the bottom-most entry that still has at least
 * TWO bullets, so an entry is never left bullet-less — an empty bullet group
 * renders as an empty LaTeX `itemize`, which tectonic refuses to compile. It
 * only ever REMOVES a bullet (never rewrites or invents), so it cannot
 * introduce a fabricated claim. Relevance-aware trimming is the tailoring
 * step's job; this is just the engine's one-page safety net.
 */
export function dropLastBullet(md: string): string | null {
  const lines = md.split(/\r?\n/);
  const isBullet = (s: string | undefined): boolean => s !== undefined && /^\s*[-*]\s+\S/.test(s);
  let i = lines.length - 1;
  while (i >= 0) {
    if (!isBullet(lines[i])) {
      i--;
      continue;
    }
    let start = i;
    while (start - 1 >= 0 && isBullet(lines[start - 1])) start--;
    if (i - start + 1 >= 2) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
    i = start - 1; // sole bullet of its entry — leave it, look further up
  }
  return null;
}

/**
 * Render a resume markdown to a one-page Jake/sb2nov PDF via render-jaketex +
 * tectonic. If the PDF overflows one page, it drops the weakest (trailing)
 * bullet and re-renders until it fits or there is nothing left to cut.
 */
export function makeJaketexPdfConverter(
  opts: {
    maxTrim?: number;
    exec?: (cmd: string, args: string[]) => Promise<void>;
    pageCount?: (pdfPath: string) => number | null;
  } = {},
): ResumeConverter {
  const scriptPath = jaketexScriptPath();
  const maxTrim = opts.maxTrim ?? 16;
  const exec = opts.exec ?? run;
  const countPages = opts.pageCount ?? pdfPageCount;
  return {
    async convert(mdPath: string, outPdfPath: string): Promise<void> {
      if (!existsSync(scriptPath)) {
        throw new Error(`resume renderer not found at ${scriptPath} (scripts/render-jaketex.mts)`);
      }
      const dir = dirname(outPdfPath);
      const texPath = outPdfPath.replace(/\.pdf$/i, '.tex');
      const srcMd = outPdfPath.replace(/\.pdf$/i, '.src.md');
      const original = readFileSync(mdPath, 'utf8');
      const srcSha256 = createHash('sha256').update(original).digest('hex');
      if (cacheHit(srcSha256, outPdfPath)) {
        log('debug', 'conversion cache hit; reusing rendered PDF', { outPdfPath });
        return;
      }
      const writeMeta = (droppedBullets: number, pageCount: number | null): void => {
        const meta: ConversionMeta = {
          srcSha256,
          droppedBullets,
          pageCount,
          renderer: 'jaketex',
          renderedAt: new Date().toISOString(),
        };
        writeFileSync(metaPathForPdf(outPdfPath), `${JSON.stringify(meta, null, 2)}\n`);
      };

      // variants[k] = original with the k weakest (trailing) bullets dropped
      const variants: string[] = [original];
      let tail = original;
      while (variants.length <= maxTrim) {
        const next = dropLastBullet(tail);
        if (next === null) break;
        variants.push(next);
        tail = next;
      }
      const maxDrops = variants.length - 1;
      const outOfBullets = dropLastBullet(tail) === null;

      const render = async (drops: number): Promise<number | null> => {
        const variant = variants[drops];
        if (variant === undefined) throw new Error(`no trim variant for ${drops} drops`);
        writeFileSync(srcMd, variant);
        await exec(process.execPath, [scriptPath, srcMd, texPath]);
        await exec('tectonic', ['--outdir', dir, texPath]);
        return countPages(outPdfPath);
      };
      const unverifiable = (drops: number): void => {
        log('warn', 'rendered resume PDF but could not verify page count (pdfinfo missing)', { outPdfPath });
        writeMeta(drops, null);
      };

      const firstPages = await render(0);
      if (firstPages === null) return unverifiable(0);
      if (firstPages <= 1) return writeMeta(0, firstPages);

      // Page count is monotone non-increasing in bullets dropped, so binary-search
      // the smallest fitting drop count instead of recompiling one drop at a time.
      const pagesAt = new Map<number, number>([[0, firstPages]]);
      let rendered = 0;
      let lo = 1;
      let hi = maxDrops + 1;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        const pages = await render(mid);
        rendered = mid;
        if (pages === null) return unverifiable(mid);
        pagesAt.set(mid, pages);
        if (pages <= 1) hi = mid;
        else lo = mid + 1;
      }

      if (lo > maxDrops) {
        const pages = pagesAt.get(maxDrops) ?? null;
        if (outOfBullets) {
          log('warn', 'resume exceeds one page and has no bullets left to trim', { pages });
          writeMeta(maxDrops, pages);
        } else {
          log('warn', 'resume still exceeds one page after maximum trim', { maxTrim });
          writeMeta(maxTrim, pages);
        }
        return;
      }

      let pages = pagesAt.get(lo) ?? null;
      if (rendered !== lo) {
        pages = await render(lo);
        if (pages === null) return unverifiable(lo);
      }
      log('info', 'trimmed resume to fit one page', { droppedBullets: lo });
      writeMeta(lo, pages);
    },
  };
}

export const jaketexPdfConverter: ResumeConverter = makeJaketexPdfConverter();
