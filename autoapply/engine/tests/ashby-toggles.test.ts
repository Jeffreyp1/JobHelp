import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  DEFAULT_TOGGLE_SELECTED,
  detectToggleGroups,
  fillChoiceGroup,
  type ChoiceGroup,
} from '../src/ats/choice-groups.ts';
import { ashbyConfig } from '../src/ats/ashby.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import type { Surface } from '../src/ats/form-config.ts';

const WORK_AUTH = 'Are you legally authorized to work in the United States?*';
const SPONSORSHIP = 'Will you now or in the future require visa sponsorship?*';
const UNKNOWN = 'What is your favorite color?*';

const ASHBY_PAGE = `
<div class="ashby-app">
  <div class="_fieldEntry_x1">
    <label class="_label_x1">${WORK_AUTH}</label>
    <div class="_yesno_x1">
      <button type="button" class="_option_x1">Yes</button>
      <button type="button" class="_option_x1">No</button>
    </div>
  </div>
  <div class="_fieldEntry_x1">
    <label class="_label_x1">${SPONSORSHIP}</label>
    <div class="_yesno_x1">
      <button type="button" class="_option_x1">Yes</button>
      <button type="button" class="_option_x1">No</button>
    </div>
  </div>
  <div class="_fieldEntry_x1">
    <label class="_label_x1">${UNKNOWN}</label>
    <div class="_yesno_x1">
      <button type="button" class="_option_x1">Red</button>
      <button type="button" class="_option_x1">Blue</button>
    </div>
  </div>
  <div class="_fieldEntry_x1">
    <label class="_label_x1">Resume/CV*</label>
    <button type="button" class="_upload_x1">Upload File</button>
  </div>
  <button type="submit">Submit Application</button>
</div>
<script>
  for (const grp of document.querySelectorAll('._yesno_x1')) {
    for (const b of grp.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        for (const o of grp.querySelectorAll('button')) o.classList.remove('_act_x1');
        b.classList.add('_act_x1');
      });
    }
  }
</script>`;

const ONSITE = 'Are you willing to work onsite?*';

const ARIA_PAGE = `
<div class="_fieldEntry_x2">
  <label class="_label_x2">${ONSITE}</label>
  <div role="radiogroup" aria-label="${ONSITE}" aria-required="true">
    <div role="radio" aria-checked="false">Yes</div>
    <div role="radio" aria-checked="false">No</div>
  </div>
</div>
<script>
  for (const r of document.querySelectorAll('[role=radio]')) {
    r.addEventListener('click', () => {
      for (const o of document.querySelectorAll('[role=radio]')) o.setAttribute('aria-checked', 'false');
      r.setAttribute('aria-checked', 'true');
    });
  }
</script>`;

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

function pages(): { newPage: (html: string) => Promise<import('playwright').Page> } {
  return {
    newPage: async (html: string) => {
      if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
      const page = await browser.newPage();
      await page.setContent(html);
      return page;
    },
  };
}

describe('DEFAULT_TOGGLE_SELECTED', () => {
  it('tries aria-pressed/aria-checked first, keeping the _act class as fallback', () => {
    expect(DEFAULT_TOGGLE_SELECTED).toBe('[aria-pressed="true"], [aria-checked="true"], [class*="_act"]');
  });
});

describe('fillChoiceGroup — button toggle groups (fake surface)', () => {
  function fakeToggle(selectedSelector: string): Surface {
    let selected = false;
    const el = { matches: (s: string) => selected && s === selectedSelector };
    const loc = {
      first: () => loc,
      click: () => {
        selected = true;
        return Promise.resolve();
      },
      evaluate: (fn: (e: unknown, a: string) => unknown, a: string) => Promise.resolve(fn(el, a)),
    };
    return { locator: () => loc } as unknown as Surface;
  }

  const group: ChoiceGroup = {
    key: 'jobhelp-grp',
    label: WORK_AUTH,
    required: true,
    kind: 'button',
    selectedSelector: '[class*="_act"]',
    checked: false,
    options: [
      { label: 'Yes', id: 'jobhelp-b1', value: '' },
      { label: 'No', id: 'jobhelp-b2', value: '' },
    ],
  };

  it('clicks the matching button and verifies selection via the selected-class selector', async () => {
    const r = await fillChoiceGroup(fakeToggle('[class*="_act"]'), group, 'Yes');
    expect(r).toEqual({ ok: true, guessed: false, chosen: 'Yes' });
  });

  it('reports not-ok when the click never produces the selected marker', async () => {
    const r = await fillChoiceGroup(fakeToggle('[data-selected="true"]'), group, 'Yes');
    expect(r).toEqual({ ok: false, guessed: false });
  });
});

describe.skipIf(browser === null)('detectToggleGroups — Ashby button pairs', () => {
  it('finds required Yes/No button groups under question labels and skips upload/submit buttons', async () => {
    const page = await pages().newPage(ASHBY_PAGE);
    try {
      const groups = await detectToggleGroups(page, ashbyConfig);
      expect(groups.map((g) => g.label)).toEqual([WORK_AUTH, SPONSORSHIP, UNKNOWN]);
      for (const g of groups) {
        expect(g.kind).toBe('button');
        expect(g.required).toBe(true);
        expect(g.checked).toBe(false);
        expect(g.selectedSelector).toBe('[aria-pressed="true"], [aria-checked="true"], [class*="_act"]');
        expect(g.key).not.toBe('');
      }
      expect(groups[0]?.options.map((o) => o.label)).toEqual(['Yes', 'No']);
      expect(groups[2]?.options.map((o) => o.label)).toEqual(['Red', 'Blue']);
      const ids = groups.flatMap((g) => g.options.map((o) => o.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).not.toBe('');
    } finally {
      await page.close();
    }
  });

  it('reports a group with the selected class already present as checked', async () => {
    const preselected = ASHBY_PAGE.replace(
      `<button type="button" class="_option_x1">No</button>
    </div>
  </div>
  <div class="_fieldEntry_x1">
    <label class="_label_x1">${UNKNOWN}</label>`,
      `<button type="button" class="_option_x1 _act_x1">No</button>
    </div>
  </div>
  <div class="_fieldEntry_x1">
    <label class="_label_x1">${UNKNOWN}</label>`,
    );
    const page = await pages().newPage(preselected);
    try {
      const groups = await detectToggleGroups(page, ashbyConfig);
      expect(groups.map((g) => g.checked)).toEqual([false, true, false]);
    } finally {
      await page.close();
    }
  });

  it('detects an aria radiogroup and fills it, verified by aria-checked', async () => {
    const page = await pages().newPage(ARIA_PAGE);
    try {
      const groups = await detectToggleGroups(page, ashbyConfig);
      expect(groups).toHaveLength(1);
      const group = groups[0];
      if (group === undefined) throw new Error('missing group');
      expect(group.label).toBe(ONSITE);
      expect(group.required).toBe(true);
      expect(group.selectedSelector).toBe('[aria-checked="true"]');
      expect(group.options.map((o) => o.label)).toEqual(['Yes', 'No']);
      const r = await fillChoiceGroup(page, group, 'Yes');
      expect(r).toEqual({ ok: true, guessed: false, chosen: 'Yes' });
      const checked = await page.evaluate(
        () => document.querySelector('[aria-checked="true"]')?.textContent ?? null,
      );
      expect(checked).toBe('Yes');
    } finally {
      await page.close();
    }
  });
});

describe.skipIf(browser === null)('makeAts + ashbyConfig — toggle fill and fail-closed validate', () => {
  async function resumePath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ashby-toggles-'));
    const p = join(dir, 'resume.pdf');
    await writeFile(p, 'pdf-bytes');
    return p;
  }

  it('fills known toggle questions by clicking the matching button', async () => {
    const page = await pages().newPage(ASHBY_PAGE);
    try {
      const ats = makeAts(ashbyConfig);
      const outcome = await ats.fill(page, { workAuthorization: 'Yes', sponsorship: 'No' }, await resumePath());
      expect(outcome.filledKnown).toBe(2);
      const selected = await page.evaluate(() =>
        Array.from(document.querySelectorAll('._yesno_x1')).map(
          (g) => g.querySelector('._act_x1')?.textContent ?? null,
        ),
      );
      expect(selected).toEqual(['Yes', 'No', null]);
    } finally {
      await page.close();
    }
  });

  it('surfaces an unfilled required toggle group as a validate blocker and clears filled ones', async () => {
    const page = await pages().newPage(ASHBY_PAGE);
    try {
      const ats = makeAts(ashbyConfig);
      await ats.fill(page, { workAuthorization: 'Yes', sponsorship: 'No' }, await resumePath());
      const v = await ats.validate(page);
      expect(v.ok).toBe(false);
      expect(v.blockers).toContain(UNKNOWN);
      expect(v.blockers).not.toContain(WORK_AUTH);
      expect(v.blockers).not.toContain(SPONSORSHIP);
    } finally {
      await page.close();
    }
  });

  it('skips an already-selected toggle group instead of re-clicking it', async () => {
    const page = await pages().newPage(ASHBY_PAGE);
    try {
      await page.evaluate(() => {
        const grp = document.querySelectorAll('._yesno_x1')[1];
        grp?.querySelectorAll('button')[0]?.classList.add('_act_x1');
      });
      const ats = makeAts(ashbyConfig);
      const outcome = await ats.fill(page, { workAuthorization: 'Yes', sponsorship: 'No' }, await resumePath());
      expect(outcome.filledKnown).toBe(1);
      const sponsorshipPick = await page.evaluate(
        () => document.querySelectorAll('._yesno_x1')[1]?.querySelector('._act_x1')?.textContent ?? null,
      );
      expect(sponsorshipPick).toBe('Yes');
    } finally {
      await page.close();
    }
  });

  it('does not double-report an aria radiogroup that requiredUncheckedGroups already flags', async () => {
    const page = await pages().newPage(ARIA_PAGE);
    try {
      const ats = makeAts(ashbyConfig);
      const v = await ats.validate(page);
      expect(v.ok).toBe(false);
      expect(v.blockers.filter((b) => b === ONSITE)).toHaveLength(1);
    } finally {
      await page.close();
    }
  });
});
