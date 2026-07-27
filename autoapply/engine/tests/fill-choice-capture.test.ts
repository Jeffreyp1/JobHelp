import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { makeAts } from '../src/ats/make-ats.ts';
import { detectByLabelFor } from '../src/ats/detect-label-for.ts';
import { resetAnswerBankCache } from '../src/answer-bank.ts';
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
let prevHome: string | undefined;

beforeAll(async () => {
  const home = await mkdtemp(join(tmpdir(), 'choice-capture-home-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = home;
  await writeFile(
    join(home, 'answer-bank.json'),
    JSON.stringify({
      entries: [
        {
          id: 'ab-1',
          question: 'Do you own a mechanical keyboard?',
          options: ['No', 'Yes'],
          answer: 'Yes',
          approved: true,
          companySpecific: false,
        },
      ],
    }),
  );
  resetAnswerBankCache();
});

afterAll(async () => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  resetAnswerBankCache();
  await browser?.close();
});

const PAGE = `<form>
  <fieldset><legend>Are you willing to relocate?</legend>
    <label><input type="radio" name="reloc" value="Yes">Yes</label>
    <label><input type="radio" name="reloc" value="No">No</label>
  </fieldset>
  <fieldset><legend>Do you own a mechanical keyboard?</legend>
    <label><input type="radio" name="kb" value="Yes">Yes</label>
    <label><input type="radio" name="kb" value="No">No</label>
  </fieldset>
</form>`;

const CFG: AtsConfig = {
  name: 'test',
  urlRe: /./,
  formSelector: 'form',
  submitSelector: 'button[type=submit]',
  detect: detectByLabelFor,
};

describe.skipIf(browser === null)('choice-group per-field capture', () => {
  it('records profile-sourced and bank-replayed group picks with sources', async () => {
    if (browser === null) throw new Error('unreachable: suite is skipped without a browser');
    const dir = await mkdtemp(join(tmpdir(), 'choice-capture-'));
    const resumePath = join(dir, 'resume.pdf');
    await writeFile(resumePath, 'pdf-bytes');
    const page = await browser.newPage();
    try {
      await page.setContent(PAGE);
      const outcome = await makeAts(CFG).fill(page, { relocation: 'Yes' }, resumePath);

      expect(await page.isChecked('input[name=reloc][value=Yes]')).toBe(true);
      expect(await page.isChecked('input[name=kb][value=Yes]')).toBe(true);

      const byKey = new Map(outcome.fields.map((f) => [f.fieldKey, f]));
      expect(byKey.get('reloc')).toEqual({
        fieldKey: 'reloc',
        question: 'Are you willing to relocate?',
        value: 'Yes',
        source: 'profile',
        options: ['Yes', 'No'],
        required: false,
      });
      expect(byKey.get('kb')).toEqual({
        fieldKey: 'kb',
        question: 'Do you own a mechanical keyboard?',
        value: 'Yes',
        source: 'answer-bank',
        exact: true,
        options: ['Yes', 'No'],
        required: false,
      });
      expect(outcome.guesses).toEqual([]);
      expect(outcome.fields).toHaveLength(outcome.filledKnown);
    } finally {
      await page.close();
    }
  });
});
