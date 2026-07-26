import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasSelectorOverride,
  loadSelectorOverrides,
  resetSelectorOverridesForTest,
  withSelectorOverrides,
} from '../src/selector-overrides.ts';
import { testCfg } from './fixtures/fake-form.ts';

async function overridesFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jobhelp-overrides-'));
  const path = join(dir, 'autoapply-selector-overrides.json');
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

beforeEach(() => {
  resetSelectorOverridesForTest();
});

describe('selector overrides', () => {
  it('is identity before load and for un-overridden adapters', async () => {
    const cfg = testCfg();
    expect(withSelectorOverrides(cfg)).toBe(cfg);
    await loadSelectorOverrides(await overridesFile({ version: 1, overrides: { other: { submitSelector: '.x' } } }));
    expect(withSelectorOverrides(cfg)).toBe(cfg);
    expect(hasSelectorOverride('fake')).toBe(false);
  });

  it('merges whitelisted fields and reports the override active', async () => {
    await loadSelectorOverrides(
      await overridesFile({
        version: 1,
        overrides: {
          fake: {
            submitSelector: '.send',
            toggleGroupSelector: '[data-on="1"]',
            reactSelect: { option: '.opt' },
            evilFn: 'ignored',
          },
        },
      }),
    );
    const merged = withSelectorOverrides(testCfg());
    expect(merged.submitSelector).toBe('.send');
    expect(merged.toggleGroupSelector).toBe('[data-on="1"]');
    expect(merged.reactSelect?.option).toBe('.opt');
    expect(merged.reactSelect?.singleValue).toBeTruthy(); // rest of ReactSelectClasses kept from defaults
    expect(hasSelectorOverride('fake')).toBe(true);
  });

  it('tolerates a malformed file (defaults, no throw)', async () => {
    await loadSelectorOverrides(await overridesFile('{broken'));
    const cfg = testCfg();
    expect(withSelectorOverrides(cfg)).toBe(cfg);
    expect(hasSelectorOverride('fake')).toBe(false);
  });

  it('ignores non-string selector values', async () => {
    await loadSelectorOverrides(await overridesFile({ version: 1, overrides: { fake: { submitSelector: 42 } } }));
    expect(hasSelectorOverride('fake')).toBe(false);
  });
});

import { formScope, resolveSubmitButton } from '../src/ats/form-dom.ts';
import { chromium, type Browser } from 'playwright';

it('an overridden submitSelector rescues a button the semantic chain cannot find', async () => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
  } catch {
    return;
  }
  const page = await browser.newPage();
  await page.setContent('<form><button type="button" class="send">Send it</button></form>');
  const cfg = { ...testCfg(), submitSelector: '#renamed-away' };
  expect(await resolveSubmitButton(page, await formScope(page, cfg), cfg)).toBeNull();
  await loadSelectorOverrides(await overridesFile({ version: 1, overrides: { fake: { submitSelector: '.send' } } }));
  const merged = withSelectorOverrides(cfg);
  const btn = await resolveSubmitButton(page, await formScope(page, merged), merged);
  expect(btn).not.toBeNull();
  await browser.close();
});
