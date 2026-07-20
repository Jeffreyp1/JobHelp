import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { AtsConfig } from './ats/form-config.ts';
import { formScope } from './ats/form-dom.ts';

export interface RepairCapture {
  readonly aria: string;
  readonly formHtml: string;
}

const ARIA_CAP = 10_000;
const HTML_CAP = 20_000;

export async function captureRepair(page: Page, cfg: AtsConfig): Promise<RepairCapture> {
  const aria = await page
    .locator('body')
    .ariaSnapshot()
    .catch(() => '');
  const formHtml = await formScope(page, cfg)
    .then((form) => form.evaluate((el) => el.innerHTML ?? el.outerHTML))
    .catch(() => '');
  return { aria: aria.slice(0, ARIA_CAP), formHtml: formHtml.slice(0, HTML_CAP) };
}

export interface RepairArtifact {
  readonly ats: string;
  readonly url: string;
  readonly failure: string;
  readonly capture: RepairCapture;
}

export async function writeRepairArtifact(root: string, a: RepairArtifact, nowIso: string): Promise<string> {
  const dir = join(root, `${a.ats}-${nowIso.replace(/[:.]/g, '-')}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'snapshot.md');
  const body = [
    `# Repair artifact: ${a.ats}`,
    '',
    `- url: ${a.url}`,
    `- failure: ${a.failure}`,
    `- ts: ${nowIso}`,
    '',
    '## Accessibility snapshot',
    '',
    a.capture.aria,
    '',
    '## Form HTML excerpt',
    '',
    a.capture.formHtml,
    '',
  ].join('\n');
  await writeFile(path, body);
  return path;
}

export async function listRepairArtifacts(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  return names
    .sort()
    .reverse()
    .map((n) => join(root, n, 'snapshot.md'));
}
