import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { formScope, resolveSubmitButton } from '../src/ats/form-dom.ts';
import type { AtsConfig } from '../src/ats/form-config.ts';

function cfgWith(submitSelector: string): AtsConfig {
  return { name: 'fake', urlRe: /fake/, formSelector: 'form', submitSelector, detect: async () => [] };
}

async function tryLaunch(): Promise<Browser | null> {
  try {
    return await chromium.launch();
  } catch {
    return null;
  }
}

let browser: Browser | null = null;
async function openFixture(html: string): Promise<Page | null> {
  browser ??= await tryLaunch();
  if (browser === null) return null;
  const dir = await mkdtemp(join(tmpdir(), 'jobhelp-submit-'));
  const file = join(dir, 'page.html');
  await writeFile(file, `<!doctype html><html><body>${html}</body></html>`);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href);
  return page;
}

afterAll(async () => {
  await browser?.close();
});

describe('resolveSubmitButton', () => {
  it('prefers the configured selector when it matches', async () => {
    const page = await openFixture('<form><button id="go" type="submit">Go</button><button type="submit">Other</button></form>');
    if (page === null) return;
    const cfg = cfgWith('#go');
    const btn = await resolveSubmitButton(page, await formScope(page, cfg), cfg);
    expect(btn).not.toBeNull();
    expect(await btn?.getAttribute('id')).toBe('go');
    await page.close();
  });

  it('falls back to a native submit button when the configured selector is stale', async () => {
    const page = await openFixture('<form><button type="submit">Send</button></form>');
    if (page === null) return;
    const cfg = cfgWith('#renamed-away');
    const btn = await resolveSubmitButton(page, await formScope(page, cfg), cfg);
    expect(btn).not.toBeNull();
    expect(await btn?.getAttribute('type')).toBe('submit');
    await page.close();
  });

  it('falls back to a button whose text says submit/apply', async () => {
    const page = await openFixture('<form><button class="w1">Submit application</button></form>');
    if (page === null) return;
    const cfg = cfgWith('#renamed-away');
    const btn = await resolveSubmitButton(page, await formScope(page, cfg), cfg);
    expect(btn).not.toBeNull();
    expect((await btn?.textContent())?.trim()).toBe('Submit application');
    await page.close();
  });

  it('returns null when nothing submit-like exists', async () => {
    const page = await openFixture('<form><button type="button">Cancel</button></form>');
    if (page === null) return;
    const cfg = cfgWith('#renamed-away');
    expect(await resolveSubmitButton(page, await formScope(page, cfg), cfg)).toBeNull();
    await page.close();
  });
});
