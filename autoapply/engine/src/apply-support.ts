import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ReadyJob } from './types.ts';
import { metaPathForPdf, pdfPathForJob } from './convert-pdf.ts';
import { readAnswers } from './freeform.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Human-visible caveats from the PDF renderer's sidecar (bullets trimmed to fit
 * one page, page count unverified/over). The sidecar's srcSha256 must match the
 * CURRENT resume markdown — a stale sidecar from an earlier render of a different
 * version must not annotate this run. */
export async function conversionNotes(job: ReadyJob): Promise<string[]> {
  let srcSha256: string;
  let droppedBullets: number;
  let pageCount: number | null;
  try {
    const parsed: unknown = JSON.parse(await readFile(metaPathForPdf(pdfPathForJob(job.dir)), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const m = parsed as Record<string, unknown>;
    if (typeof m['srcSha256'] !== 'string' || typeof m['droppedBullets'] !== 'number') return [];
    srcSha256 = m['srcSha256'];
    droppedBullets = m['droppedBullets'];
    pageCount = typeof m['pageCount'] === 'number' ? m['pageCount'] : null;
  } catch {
    return [];
  }
  try {
    const src = await readFile(job.resumeMdPath, 'utf8');
    if (createHash('sha256').update(src).digest('hex') !== srcSha256) return [];
  } catch {
    return [];
  }
  const notes: string[] = [];
  if (droppedBullets > 0) notes.push(`PDF trimmed: ${droppedBullets} bullets dropped`);
  if (pageCount === null) notes.push('PDF page count unverified');
  else if (pageCount > 1) notes.push(`PDF is still ${pageCount} pages after trimming`);
  return notes;
}

export async function waitForAnswers(dir: string, waitMs: number): Promise<Record<string, string> | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const answers = await readAnswers(dir);
    if (answers) return answers;
    if (Date.now() >= deadline) return null;
    await sleep(500);
  }
}
