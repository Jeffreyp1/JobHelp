import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { captureRepair, listRepairArtifacts, writeRepairArtifact } from '../src/repair-artifact.ts';
import { testCfg } from './fixtures/fake-form.ts';

function fakePageForCapture(aria: string, html: string): Page {
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['evaluate'] = () => Promise.resolve(html);
  const body: Record<string, unknown> = {};
  body['ariaSnapshot'] = () => Promise.resolve(aria);
  body['first'] = () => body;
  return {
    locator: (sel: string) => (sel === 'body' ? body : form),
  } as unknown as Page;
}

describe('repair artifacts', () => {
  it('captures aria + form html with caps', async () => {
    const capture = await captureRepair(fakePageForCapture('ARIA'.repeat(5000), '<form>x</form>'), testCfg());
    expect(capture.aria.length).toBeLessThanOrEqual(10_000);
    expect(capture.formHtml).toBe('<form>x</form>');
  });

  it('writes and lists artifacts newest first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhelp-repair-'));
    const a = { ats: 'ashby', url: 'https://x/1', failure: 'no fields detected', capture: { aria: 'A', formHtml: 'H' } };
    const p1 = await writeRepairArtifact(root, a, '2026-07-20T01:00:00.000Z');
    const p2 = await writeRepairArtifact(root, { ...a, failure: 'canary drift' }, '2026-07-20T02:00:00.000Z');
    const listed = await listRepairArtifacts(root);
    expect(listed).toEqual([p2, p1]);
    const body = await readFile(p2, 'utf8');
    expect(body).toContain('# Repair artifact: ashby');
    expect(body).toContain('- failure: canary drift');
    expect(body).toContain('## Accessibility snapshot');
  });

  it('lists [] when the root does not exist', async () => {
    expect(await listRepairArtifacts(join(tmpdir(), 'jobhelp-none-', 'missing'))).toEqual([]);
  });
});
