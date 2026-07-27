import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { makeAts } from '../src/ats/make-ats.ts';
import { detectByLabelFor } from '../src/ats/detect-label-for.ts';
import type { AtsConfig } from '../src/ats/form-config.ts';

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

const PAGE = `<form>
  <label for="first_name">First Name *</label><input id="first_name" type="text" required>
  <label for="email">Email *</label><input id="email" type="email" required>
  <label for="years">Years of experience</label>
  <select id="years"><option value=""></option><option>0-1 years</option><option>2-4 years</option><option>5+ years</option></select>
  <label for="why">Why us?</label><textarea id="why"></textarea>
</form>`;

const VALUES: Record<string, string> = {
  first_name: 'Jane Doe',
  email: 'jane@example.com',
  years: '2',
};

const CFG: AtsConfig = {
  name: 'test',
  urlRe: /./,
  formSelector: 'form',
  submitSelector: 'button[type=submit]',
  detect: async (s, c) => (await detectByLabelFor(s, c)).filter((f) => f.type !== 'file'),
  resolveValue: (field) => VALUES[field.id],
};

describe.skipIf(browser === null)('per-field capture in fill', () => {
  it('records every filled field with value and source; freeform stays out', async () => {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const dir = await mkdtemp(join(tmpdir(), 'fill-capture-'));
    const resumePath = join(dir, 'resume.pdf');
    await writeFile(resumePath, 'pdf-bytes');
    const page = await browser.newPage();
    try {
      await page.setContent(PAGE);
      const outcome = await makeAts(CFG).fill(page, {}, resumePath);

      const byKey = new Map(outcome.fields.map((f) => [f.fieldKey, f]));
      expect(byKey.get('first_name')).toEqual({
        fieldKey: 'first_name',
        question: 'First Name *',
        value: 'Jane Doe',
        source: 'profile',
        required: true,
      });
      expect(byKey.get('email')).toEqual({
        fieldKey: 'email',
        question: 'Email *',
        value: 'jane@example.com',
        source: 'profile',
        required: true,
      });

      const years = byKey.get('years');
      expect(years?.source).toBe('guessed');
      expect(years?.reason).toBe('dropdown');
      expect(years?.value).toBe('2-4 years');

      expect(byKey.has('why')).toBe(false);
      expect(outcome.freeform.map((q) => q.fieldKey)).toEqual(['why']);
      expect(outcome.fields).toHaveLength(outcome.filledKnown);
      expect(outcome.filledKnown).toBe(3);
    } finally {
      await page.close();
    }
  });
});
