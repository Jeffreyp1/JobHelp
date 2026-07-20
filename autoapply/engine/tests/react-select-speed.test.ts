import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { probeSequence } from '../src/ats/option-match.ts';
import { awaitMenuOutcome, fillReactSelect, readSelectOptions } from '../src/ats/react-select.ts';
import {
  DEFAULT_PROBE_BUDGET_MS,
  DEFAULT_REACT_SELECT,
  type ReactSelectClasses,
  type Surface,
} from '../src/ats/form-config.ts';

function testRs(over: { loading?: string; probeBudgetMs?: number } = {}): ReactSelectClasses {
  return { option: 'OPT', noOptions: 'NOPT', singleValue: 'SV', ...over };
}

interface Visibility {
  readonly from: number | null;
  readonly until?: number;
}

function timedLocator(vis: Visibility, texts: readonly string[] = []): Locator {
  const start = Date.now();
  const at = (): number => Date.now() - start;
  const visible = (): boolean =>
    vis.from !== null && at() >= vis.from && (vis.until === undefined || at() < vis.until);
  const loc: Record<string, unknown> = {};
  loc['first'] = () => loc;
  loc['nth'] = () => loc;
  loc['click'] = () => Promise.resolve();
  loc['isVisible'] = () => Promise.resolve(visible());
  loc['count'] = () => Promise.resolve(visible() ? texts.length : 0);
  loc['allTextContents'] = () => Promise.resolve(visible() ? [...texts] : []);
  loc['waitFor'] = ({ timeout }: { timeout: number }) =>
    new Promise<void>((resolve, reject) => {
      if (visible()) {
        resolve();
        return;
      }
      const reachable = vis.from !== null && at() < (vis.until ?? Number.POSITIVE_INFINITY);
      const wait = reachable && vis.from !== null ? vis.from - at() : Number.POSITIVE_INFINITY;
      if (wait > timeout) setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      else setTimeout(resolve, Math.max(wait, 0));
    });
  return loc as unknown as Locator;
}

function fakeInput(): { locator: Locator; calls: string[] } {
  const calls: string[] = [];
  const loc: Record<string, unknown> = {};
  loc['first'] = () => loc;
  loc['click'] = () => Promise.resolve();
  loc['fill'] = (v: string) => {
    calls.push(`fill:${v}`);
    return Promise.resolve();
  };
  loc['pressSequentially'] = (v: string) => {
    calls.push(`type:${v}`);
    return Promise.resolve();
  };
  loc['press'] = () => Promise.resolve();
  loc['evaluate'] = (
    fn: (el: {
      getAttribute(name: string): string | null;
      setAttribute(name: string, value: string): void;
      removeAttribute(name: string): void;
    }) => unknown,
  ) => Promise.resolve(fn({ getAttribute: () => null, setAttribute: () => undefined, removeAttribute: () => undefined }));
  return { locator: loc as unknown as Locator, calls };
}

function fakeSurface(map: Record<string, Locator>): Surface {
  const dead = timedLocator({ from: null });
  return {
    locator: (sel: string) => {
      for (const [key, loc] of Object.entries(map)) {
        if (sel === key || sel.includes(`"${key}"`)) return loc;
      }
      return dead;
    },
  } as unknown as Surface;
}

describe('probeSequence', () => {
  it('leads with the full value and keeps the empty probe last', () => {
    const probes = probeSequence('Example State University, Fremont');
    expect(probes[0]).toBe('Example State University, Fremont');
    expect(probes.at(-1)).toBe('');
  });

  it('keeps distinctive tokens for async typeaheads and never duplicates a probe', () => {
    const probes = probeSequence('Example State University, Fremont');
    expect(probes).toContain('example');
    expect(probes).toContain('fremont');
    expect(new Set(probes).size).toBe(probes.length);
  });
});

describe('react-select config defaults', () => {
  it('ships a ~5s probe budget and a loading selector', () => {
    expect(DEFAULT_PROBE_BUDGET_MS).toBe(5000);
    expect(DEFAULT_REACT_SELECT.loading).toContain('loading');
  });
});

describe('awaitMenuOutcome', () => {
  it('resolves empty as soon as the no-options notice shows', async () => {
    const options = timedLocator({ from: null });
    const surface = fakeSurface({ NOPT: timedLocator({ from: 0 }, ['No options']) });
    const t0 = Date.now();
    const outcome = await awaitMenuOutcome(surface, options, testRs({ loading: 'LOAD' }), 500, Date.now() + 2000);
    expect(outcome).toBe('empty');
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it('extends past the base timeout while a loading indicator is visible', async () => {
    const options = timedLocator({ from: 300 }, ['A']);
    const surface = fakeSurface({ LOAD: timedLocator({ from: 0, until: 600 }) });
    const outcome = await awaitMenuOutcome(surface, options, testRs({ loading: 'LOAD' }), 100, Date.now() + 2000);
    expect(outcome).toBe('options');
  });

  it('gives up at the base timeout when nothing is loading', async () => {
    const options = timedLocator({ from: 900 }, ['A']);
    const surface = fakeSurface({});
    const t0 = Date.now();
    const outcome = await awaitMenuOutcome(surface, options, testRs({ loading: 'LOAD' }), 100, Date.now() + 2000);
    expect(outcome).toBe('none');
    expect(Date.now() - t0).toBeLessThan(600);
  });

  it('never waits past the deadline even while loading stays visible', async () => {
    const options = timedLocator({ from: null });
    const surface = fakeSurface({ LOAD: timedLocator({ from: 0 }) });
    const t0 = Date.now();
    const outcome = await awaitMenuOutcome(surface, options, testRs({ loading: 'LOAD' }), 100, Date.now() + 400);
    const elapsed = Date.now() - t0;
    expect(outcome).toBe('none');
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('fillReactSelect probe loop', () => {
  it('drives probes with fill, never pressSequentially', async () => {
    const { locator: input, calls } = fakeInput();
    const surface = fakeSurface({
      combo: input,
      OPT: timedLocator({ from: 0 }, ['United States', 'Canada']),
    });
    const res = await fillReactSelect(surface, 'combo', 'United States', testRs({ loading: 'LOAD' }));
    expect(res).toEqual({ selected: true, guessed: false, chosen: 'United States' });
    expect(calls).toContain('fill:United States');
    expect(calls.some((c) => c.startsWith('type:'))).toBe(false);
  });

  it('bails within the configured probe budget when the combobox is dead', async () => {
    const { locator: input } = fakeInput();
    const surface = fakeSurface({ combo: input });
    const t0 = Date.now();
    const res = await fillReactSelect(surface, 'combo', 'Quantum Widgets', testRs({ probeBudgetMs: 250 }));
    expect(res).toEqual({ selected: false, guessed: false });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('readSelectOptions', () => {
  it('returns immediately on a no-options notice instead of waiting out the fixed period', async () => {
    const { locator: input } = fakeInput();
    const surface = fakeSurface({ combo: input, NOPT: timedLocator({ from: 0 }, ['No options']) });
    const t0 = Date.now();
    const texts = await readSelectOptions(surface, 'combo', testRs());
    expect(texts).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(700);
  });

  it('reads options that appear only after a loading state outlives the base wait', async () => {
    const { locator: input } = fakeInput();
    const surface = fakeSurface({
      combo: input,
      OPT: timedLocator({ from: 1700 }, ['Alpha', 'Beta']),
      LOAD: timedLocator({ from: 0, until: 1900 }),
    });
    const texts = await readSelectOptions(surface, 'combo', testRs({ loading: 'LOAD' }));
    expect(texts).toEqual(['Alpha', 'Beta']);
  });
});

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

function fixtureHtml(opts: { options: readonly string[]; loadMs: number; openOnFocus: boolean }): string {
  return `<div class="select"><input id="combo" role="combobox" autocomplete="off"><div id="menu"></div></div>
<script>
const cfg = ${JSON.stringify(opts)};
const input = document.getElementById('combo');
const menu = document.getElementById('menu');
let timer = null;
function search() {
  menu.innerHTML = '<div class="select__menu-notice select__menu-notice--loading">Loading...</div>';
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    const q = input.value.toLowerCase();
    const hits = cfg.options.filter((o) => o.toLowerCase().includes(q));
    menu.innerHTML = hits.length
      ? hits.map((o) => '<div class="select__option" role="option">' + o + '</div>').join('')
      : '<div class="select__menu-notice select__menu-notice--no-options">No options</div>';
  }, cfg.loadMs);
}
input.addEventListener('input', search);
if (cfg.openOnFocus) input.addEventListener('focus', search);
</script>`;
}

const DEAD_HTML = '<div class="select"><input id="combo" role="combobox"><div id="menu"></div></div>';

describe.skipIf(browser === null)('react-select speed against a real browser', () => {
  async function pageWith(html: string): Promise<Page> {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const page = await browser.newPage();
    await page.setContent(html);
    return page;
  }

  it('fill-driven probes open an input-event combobox and pick the exact option', async () => {
    const page = await pageWith(
      fixtureHtml({ options: ['United States of America', 'Canada'], loadMs: 30, openOnFocus: false }),
    );
    try {
      const res = await fillReactSelect(page, 'combo', 'United States of America');
      expect(res).toEqual({ selected: true, guessed: false, chosen: 'United States of America' });
    } finally {
      await page.close();
    }
  });

  it('readSelectOptions outlasts a Loading state that exceeds its base wait', async () => {
    const page = await pageWith(
      fixtureHtml({ options: ['Alpha Corp', 'Beta LLC', 'Gamma Inc'], loadMs: 2000, openOnFocus: true }),
    );
    try {
      const t0 = Date.now();
      const texts = await readSelectOptions(page, 'combo');
      expect(texts).toEqual(['Alpha Corp', 'Beta LLC', 'Gamma Inc']);
      expect(Date.now() - t0).toBeLessThan(4500);
    } finally {
      await page.close();
    }
  });

  it('a dead combobox bails at the probe budget instead of burning every probe wait', async () => {
    const page = await pageWith(DEAD_HTML);
    try {
      const t0 = Date.now();
      const res = await fillReactSelect(page, 'combo', 'Quantum Widgets', {
        ...DEFAULT_REACT_SELECT,
        probeBudgetMs: 800,
      });
      expect(res).toEqual({ selected: false, guessed: false });
      expect(Date.now() - t0).toBeLessThan(2600);
    } finally {
      await page.close();
    }
  });
});
