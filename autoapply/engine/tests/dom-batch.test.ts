import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { batchFillText } from '../src/ats/form-dom.ts';
import { detectByLabelFor } from '../src/ats/detect-label-for.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import type { AtsConfig } from '../src/ats/form-config.ts';

const CFG: AtsConfig = {
  name: 'test',
  urlRe: /./,
  formSelector: 'form',
  submitSelector: 'button[type=submit]',
  detect: detectByLabelFor,
};

async function tryLaunch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    // managed chromium not installed; fall through to the system Chrome channel
  }
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return null;
  }
}

const browser = await tryLaunch();

afterAll(async () => {
  await browser?.close();
});

const EVENTS_PAGE = `<form>
  <input id="fname" type="text">
  <input id="email" type="email">
  <input id="phone" type="tel">
  <input id="site" type="url">
  <textarea name="why"></textarea>
</form>
<script>
window.__events = [];
const key = (t) => t.id || t.getAttribute('name');
document.addEventListener('input', (e) => window.__events.push('input:' + key(e.target)));
document.addEventListener('change', (e) => window.__events.push('change:' + key(e.target)));
</script>`;

const REACT_PAGE = `<form><input id="fname" type="text"></form>
<script>
const input = document.getElementById('fname');
const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
let state = '';
let tracked = input.value;
Object.defineProperty(input, 'value', {
  configurable: true,
  get() { return desc.get.call(this); },
  set(v) { tracked = String(v); desc.set.call(this, v); },
});
input.addEventListener('input', () => {
  const cur = desc.get.call(input);
  if (cur !== tracked) state = cur;
  tracked = state;
  desc.set.call(input, state);
});
window.__state = () => state;
</script>`;

const FIXTURE_URL = new URL('../../fixtures/greenhouse-react.html', import.meta.url).href;

describe.skipIf(browser === null)('batchFillText — real browser', () => {
  async function pageWith(html: string): Promise<Page> {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const page = await browser.newPage();
    await page.setContent(html);
    return page;
  }

  it('lands text/email/tel/url/textarea in one call and fires bubbling input+change per field', async () => {
    const page = await pageWith(EVENTS_PAGE);
    try {
      const landed = await batchFillText(page, CFG, [
        { key: 'fname', value: 'Jane' },
        { key: 'email', value: 'jane@example.com' },
        { key: 'phone', value: '555-0100' },
        { key: 'site', value: 'https://jane.dev' },
        { key: 'why', value: 'Because.' },
        { key: 'missing', value: 'nope' },
      ]);
      expect([...landed].sort()).toEqual(['email', 'fname', 'phone', 'site', 'why']);
      expect(await page.inputValue('#fname')).toBe('Jane');
      expect(await page.inputValue('textarea[name=why]')).toBe('Because.');
      const events = await page.evaluate(() => (window as unknown as { __events: string[] }).__events);
      for (const k of ['fname', 'email', 'phone', 'site', 'why']) {
        expect(events).toContain(`input:${k}`);
        expect(events).toContain(`change:${k}`);
      }
    } finally {
      await page.close();
    }
  });

  it('updates a React-style controlled input whose tracker reverts naive value writes', async () => {
    const page = await pageWith(REACT_PAGE);
    try {
      await page.evaluate(() => {
        const el = document.getElementById('fname');
        if (!(el instanceof HTMLInputElement)) throw new Error('missing input');
        el.value = 'naive';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(await page.inputValue('#fname')).toBe('');
      const landed = await batchFillText(page, CFG, [{ key: 'fname', value: 'Jane' }]);
      expect([...landed]).toEqual(['fname']);
      expect(await page.inputValue('#fname')).toBe('Jane');
      const state = await page.evaluate(() => (window as unknown as { __state: () => string }).__state());
      expect(state).toBe('Jane');
    } finally {
      await page.close();
    }
  });

  it('reports a field whose controlled owner rejects the value as not landed', async () => {
    const page = await pageWith(`<form><input id="locked" type="text"></form>
<script>
const el = document.getElementById('locked');
el.addEventListener('input', () => { el.value = ''; });
</script>`);
    try {
      const landed = await batchFillText(page, CFG, [{ key: 'locked', value: 'nope' }]);
      expect(landed.size).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('fills the greenhouse react fixture text fields through makeAts.fill', async () => {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const dir = await mkdtemp(join(tmpdir(), 'dom-batch-'));
    const resumePath = join(dir, 'resume.pdf');
    await writeFile(resumePath, 'pdf-bytes');
    const values: Record<string, string> = { first_name: 'Jane Doe', 'start-year--0': '2019' };
    const cfg: AtsConfig = {
      ...CFG,
      detect: async (s, c) => (await detectByLabelFor(s, c)).filter((f) => !f.reactSelect && f.type !== 'file'),
      resolveValue: (field) => values[field.id],
    };
    const ats = makeAts(cfg);
    const page = await browser.newPage();
    try {
      await page.goto(FIXTURE_URL);
      const outcome = await ats.fill(page, {}, resumePath);
      expect(await page.inputValue('#first_name')).toBe('Jane Doe');
      expect(await page.inputValue('#start-year--0')).toBe('2019');
      expect(outcome.filledKnown).toBe(2);
      expect(outcome.freeform).toEqual([]);
      expect(outcome.resumeUploaded).toBe(true);
    } finally {
      await page.close();
    }
  });
});

describe.skipIf(browser === null)('detectByLabelFor — single-pass detection', () => {
  it('finds the fixture fields with the same shape as the per-label walk', async () => {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const page = await browser.newPage();
    try {
      await page.goto(FIXTURE_URL);
      const fields = await detectByLabelFor(page, CFG);
      const byId = new Map(fields.map((f) => [f.id, f]));
      expect(byId.get('first_name')).toEqual({
        id: 'first_name',
        label: 'First Name *',
        tag: 'input',
        type: 'text',
        required: true,
        reactSelect: false,
      });
      expect(byId.get('country')?.reactSelect).toBe(true);
      expect(byId.get('country')?.required).toBe(true);
      expect(byId.get('school--0')?.reactSelect).toBe(true);
      expect(byId.get('start-year--0')?.type).toBe('number');
      expect(byId.get('start-year--0')?.required).toBe(true);
      expect(byId.get('resume')?.type).toBe('file');
      expect(byId.get('cover_letter')?.type).toBe('file');
    } finally {
      await page.close();
    }
  });

  it('skips captcha, dangling and non-control targets and dedupes repeated labels', async () => {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const page = await browser.newPage();
    try {
      await page.setContent(`<form>
        <label for="g-recaptcha-response">Captcha</label><textarea id="g-recaptcha-response"></textarea>
        <label for="a">Question A *</label><input id="a" type="text">
        <label for="a">Duplicate</label>
        <label for="missing">Ghost</label>
        <label for="d">Div target</label><div id="d"></div>
        <label for="s">Pick</label><select id="s" aria-required="true"><option>x</option></select>
      </form>`);
      const fields = await detectByLabelFor(page, CFG);
      expect(fields).toEqual([
        { id: 'a', label: 'Question A *', tag: 'input', type: 'text', required: true, reactSelect: false },
        { id: 's', label: 'Pick', tag: 'select', type: 'select', required: true, reactSelect: false },
      ]);
    } finally {
      await page.close();
    }
  });
});
