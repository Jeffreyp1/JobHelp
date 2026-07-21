// Render a resume markdown to a SAVED .docx and verify it is one page.
// Usage: npx tsx scripts/verify-onepage.mts <resume.md> [out.docx]
//   - Renders <resume.md> -> .docx (kept at [out.docx], or next to the .md by default).
//   - Converts a copy to PDF (soffice) and counts pages (pdfinfo).
// Exit 0 = PASS (1 page), 1 = REJECT (2+ pages), 2 = tooling/usage error.
// The .docx is saved regardless of the page verdict (it is the deliverable).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const inPath = process.argv[2];
if (!inPath || !existsSync(inPath)) {
  console.error('usage: npx tsx scripts/verify-onepage.mts <resume.md> [out.docx]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'onepage-'));
const profile = `file://${join(work, 'lo-profile')}`; // isolated LO profile so a running GUI instance can't block headless convert

const isMd = extname(inPath).toLowerCase() === '.md';
// Where the kept .docx lives: explicit arg, else next to the .md (same name, .docx).
const outDocx = process.argv[3]
  ? resolve(process.argv[3])
  : (isMd ? resolve(dirname(inPath), basename(inPath).replace(/\.md$/i, '.docx')) : resolve(inPath));

if (isMd) {
  execFileSync('npx', ['tsx', join(here, 'render-jakestyle.mts'), inPath, outDocx], { stdio: 'inherit' });
}

// Convert a temp copy to PDF for page counting (leave the saved .docx untouched).
const tmpDocx = join(work, basename(outDocx));
copyFileSync(outDocx, tmpDocx);
execFileSync('soffice', [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', work, tmpDocx], { stdio: 'ignore' });
const pdfPath = join(work, basename(tmpDocx).replace(/\.docx$/i, '.pdf'));
if (!existsSync(pdfPath)) {
  console.error(`saved .docx: ${outDocx}`);
  console.error('REJECT (tooling): PDF conversion produced no output, could not verify page count.');
  process.exit(2);
}

const pages = Number(execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1]);
console.log(`saved .docx: ${outDocx}`);
if (pages === 1) {
  console.log('PASS — renders to 1 page.');
  process.exit(0);
}
if (!Number.isFinite(pages)) {
  console.error('REJECT (tooling): could not read page count from pdfinfo.');
  process.exit(2);
}
console.error(`REJECT — renders to ${pages} pages (hard limit is 1). The .docx was still saved; trim content and re-run.`);
process.exit(1);
