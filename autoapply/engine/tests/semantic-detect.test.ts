import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { fillReactSelect, reactSelectSelected } from '../src/ats/react-select.ts';

const ALIEN_COMBO = `
<form>
  <div class="zq1">
    <label for="country">Country</label>
    <div class="zq2">
      <div class="zq3">
        <div class="zq4">Select...</div>
        <div class="zq5"><input id="country" role="combobox" aria-expanded="false" /></div>
      </div>
    </div>
  </div>
  <button type="submit">Submit application</button>
</form>
<div class="zq6" id="menu" hidden>
  <div role="option" class="zq7">Canada</div>
  <div role="option" class="zq7">United States</div>
</div>
<script>
  const input = document.getElementById('country');
  const menu = document.getElementById('menu');
  input.addEventListener('click', () => { menu.hidden = false; });
  input.addEventListener('input', () => { menu.hidden = false; });
  for (const opt of menu.querySelectorAll('[role=option]')) {
    opt.addEventListener('click', () => {
      document.querySelector('.zq4').textContent = opt.textContent;
      input.value = '';
      menu.hidden = true;
    });
  }
</script>`;

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
  const dir = await mkdtemp(join(tmpdir(), 'jobhelp-semantic-'));
  const file = join(dir, 'page.html');
  await writeFile(file, `<!doctype html><html><body>${html}</body></html>`);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href);
  return page;
}

afterAll(async () => {
  await browser?.close();
});

describe('class-independent combobox verification', () => {
  it('verifies a pick on a combobox with unrecognizable class names', async () => {
    const page = await openFixture(ALIEN_COMBO);
    if (page === null) return;
    const res = await fillReactSelect(page, 'country', 'United States');
    expect(res.selected).toBe(true);
    expect(await reactSelectSelected(page, 'country')).toBe(true);
    await page.close();
  });

  it('still reports an untouched alien combobox as NOT selected', async () => {
    const page = await openFixture(ALIEN_COMBO);
    if (page === null) return;
    expect(await reactSelectSelected(page, 'country')).toBe(false);
    await page.close();
  });
});
