import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import { bankKey, normalizeQuestion, lookupApproved, resetAnswerBankCache } from '../src/answer-bank.ts';
import { setOverridesPath } from '../src/match.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import { DEFAULT_REACT_SELECT, type AtsConfig, type DetectedField } from '../src/ats/form-config.ts';
import type { ChoiceGroup } from '../src/ats/choice-groups.ts';

let home: string;
let prevHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'answer-bank-test-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = home;
  resetAnswerBankCache();
  setOverridesPath(join(home, 'no-overrides.json'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  resetAnswerBankCache();
});

async function writeBank(entries: unknown[]): Promise<void> {
  await writeFile(join(home, 'answer-bank.json'), JSON.stringify({ entries }));
}

function approvedEntry(question: string, answer: string, options: string[] = []): Record<string, unknown> {
  return { id: 'ab-1', question, answer, options, key: bankKey(question, options), approved: true };
}

/** The derivation exactly as the auto-apply-review skill documents it. */
function skillKey(question: string, options: string[]): string {
  const nq = question
    .trim()
    .toLowerCase()
    .replace(/[*?.:]+$/, '')
    .replace(/[,:;'"()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(JSON.stringify([nq, options.slice().sort()])).digest('hex');
}

describe('bankKey derivation matches the review skill byte-for-byte', () => {
  it('normalizes trim, case, trailing punctuation run, inner punctuation, whitespace', () => {
    expect(normalizeQuestion('  How did YOU hear about us?* ')).toBe('how did you hear about us');
    expect(normalizeQuestion("What's your (current, approximate) salary:")).toBe(
      'whats your current approximate salary',
    );
    expect(normalizeQuestion('A   B\tC')).toBe('a b c');
  });

  it('derives the documented sha256 for question + sorted options', () => {
    const q = '  Are you Authorized, to work in the U.S.? *';
    expect(bankKey(q, ['Yes', 'No'])).toBe(skillKey(q, ['Yes', 'No']));
    expect(bankKey(q, [])).toBe(skillKey(q, []));
  });

  it('is insensitive to option order but distinguishes free-text from optioned', () => {
    const q = 'Willing to relocate?';
    expect(bankKey(q, ['Yes', 'No'])).toBe(bankKey(q, ['No', 'Yes']));
    expect(bankKey(q, [])).not.toBe(bankKey(q, ['Yes', 'No']));
  });
});

describe('lookupApproved', () => {
  it('returns an exact hit when the option set hashes to the stored key', async () => {
    await writeBank([approvedEntry('Willing to relocate?', 'Yes', ['No', 'Yes'])]);
    expect(await lookupApproved('Willing to relocate?', ['Yes', 'No'])).toEqual({ answer: 'Yes', exact: true });
  });

  it('falls back to the free-text entry with exact false when option sets differ', async () => {
    await writeBank([approvedEntry('Preferred office?', 'Berlin')]);
    expect(await lookupApproved('Preferred office?', ['Berlin', 'London'])).toEqual({ answer: 'Berlin', exact: false });
  });

  it('a free-text field replay is never exact', async () => {
    await writeBank([approvedEntry('Describe your LLM experience', 'Built LLM-as-judge evals.')]);
    expect(await lookupApproved('Describe your LLM experience', [])).toEqual({
      answer: 'Built LLM-as-judge evals.',
      exact: false,
    });
  });

  it('ignores unapproved and companySpecific entries', async () => {
    await writeBank([
      { ...approvedEntry('Pending question', 'draft'), approved: false },
      { ...approvedEntry('Why join this company?', 'Because Writer...'), companySpecific: true },
    ]);
    expect(await lookupApproved('Pending question', [])).toBeNull();
    expect(await lookupApproved('Why join this company?', [])).toBeNull();
  });

  it('matches a legacy entry without options/key as free-text', async () => {
    await writeBank([{ question: 'Notice period?', answer: '2 weeks', approved: true }]);
    expect(await lookupApproved('Notice period?', [])).toEqual({ answer: '2 weeks', exact: false });
  });

  it('still matches on the stored key when the entry question drifted from it', async () => {
    const key = bankKey('New wording?', ['No', 'Yes']);
    await writeBank([{ question: 'Old wording?', answer: 'Yes', options: ['No', 'Yes'], key, approved: true }]);
    expect(await lookupApproved('New wording?', ['Yes', 'No'])).toEqual({ answer: 'Yes', exact: true });
  });

  it('tolerates a missing, malformed, or wrongly shaped bank without crashing', async () => {
    expect(await lookupApproved('anything', [])).toBeNull();
    resetAnswerBankCache();
    await writeFile(join(home, 'answer-bank.json'), 'not json');
    expect(await lookupApproved('anything', [])).toBeNull();
    resetAnswerBankCache();
    await writeFile(join(home, 'answer-bank.json'), JSON.stringify({ entries: 'nope' }));
    expect(await lookupApproved('anything', [])).toBeNull();
  });

  it('loads once per run until the cache is reset', async () => {
    await writeBank([approvedEntry('Notice period?', '2 weeks')]);
    expect(await lookupApproved('Notice period?', [])).not.toBeNull();
    await writeBank([]);
    expect(await lookupApproved('Notice period?', [])).not.toBeNull();
    resetAnswerBankCache();
    expect(await lookupApproved('Notice period?', [])).toBeNull();
  });
});

interface Harness {
  readonly page: Page;
  readonly cfg: AtsConfig;
  readonly selected: (key: string) => string;
  readonly fills: (key: string) => string[];
  readonly clicked: (key: string) => boolean;
}

function harness(fields: DetectedField[], selects: Record<string, string[]>, toggles: ChoiceGroup[] = []): Harness {
  const controls = new Map<string, Record<string, unknown>>();
  const state = { selected: new Map<string, string>(), fills: new Map<string, string[]>(), clicked: new Set<string>() };
  for (const f of fields) {
    const options = selects[f.id];
    const loc: Record<string, unknown> = {};
    loc['first'] = () => loc;
    if (options !== undefined) {
      loc['locator'] = () => ({
        evaluateAll: (fn: (els: unknown[]) => unknown) =>
          Promise.resolve(fn(options.map((o) => ({ value: o, textContent: o })))),
      });
      loc['selectOption'] = (opt: { label: string }) => {
        if (!options.includes(opt.label)) return Promise.reject(new Error('no such option'));
        state.selected.set(f.id, opt.label);
        return Promise.resolve([opt.label]);
      };
    } else {
      loc['fill'] = (v: string) => {
        state.fills.set(f.id, [...(state.fills.get(f.id) ?? []), v]);
        return Promise.resolve();
      };
      loc['inputValue'] = () => Promise.resolve(state.fills.get(f.id)?.at(-1) ?? '');
    }
    controls.set(f.id, loc);
  }
  for (const g of toggles) {
    for (const o of g.options) {
      const loc: Record<string, unknown> = {};
      loc['first'] = () => loc;
      loc['click'] = () => {
        state.clicked.add(o.id);
        return Promise.resolve();
      };
      loc['evaluate'] = () => Promise.resolve(state.clicked.has(o.id));
      controls.set(o.id, loc);
    }
  }
  const generic: Record<string, unknown> = {};
  generic['count'] = () => Promise.resolve(0);
  generic['first'] = () => generic;
  generic['locator'] = () => generic;
  const dispatch = (sel: string): unknown => {
    for (const [key, loc] of controls) if (sel.includes(`"${key}"`)) return loc;
    return generic;
  };
  const fileLocator = {
    elementHandles: () => Promise.resolve([]),
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn([])),
  };
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['waitFor'] = () => Promise.resolve();
  form['locator'] = (sel: string) => {
    if (sel === 'input[type=file]') return fileLocator;
    if (sel === 'input, select, textarea') return { count: () => Promise.resolve(fields.length) };
    return dispatch(sel);
  };
  form['evaluate'] = (fn: (r: unknown) => unknown, arg?: Array<{ key: string; value: string }>) =>
    arg === undefined ? Promise.resolve(fn({ querySelectorAll: () => [] })) : Promise.resolve(arg.map((e) => e.key));
  const cfg: AtsConfig = {
    name: 'fake',
    urlRe: /fake/,
    formSelector: 'form',
    submitSelector: 'button[type=submit]',
    reactSelect: { ...DEFAULT_REACT_SELECT, probeBudgetMs: 1 },
    detect: async () => fields,
    ...(toggles.length > 0 ? { detectToggleGroups: async () => toggles } : {}),
  };
  const page = {
    locator: (sel: string) => (sel === 'form' ? form : dispatch(sel)),
    goto: () => Promise.resolve(null),
    waitForLoadState: () => Promise.resolve(),
  } as unknown as Page;
  return {
    page,
    cfg,
    selected: (key) => state.selected.get(key) ?? '',
    fills: (key) => state.fills.get(key) ?? [],
    clicked: (key) => state.clicked.has(key),
  };
}

describe('makeAts fill consults the answer bank after the profile', () => {
  const OFFICE: DetectedField = {
    id: 'office',
    label: 'Which office would you prefer',
    tag: 'select',
    type: 'select',
    required: true,
    reactSelect: false,
  };
  const ESSAY: DetectedField = {
    id: 'essay',
    label: 'Describe your LLM experience',
    tag: 'input',
    type: 'text',
    required: false,
    reactSelect: false,
  };

  it('fills a select deterministically on an exact option-set match (no guess)', async () => {
    await writeBank([approvedEntry('Which office would you prefer', 'Berlin', ['Berlin', 'London'])]);
    const h = harness([OFFICE], { office: ['Berlin', 'London'] });
    const outcome = await makeAts(h.cfg).fill(h.page, {}, '/tmp/resume.pdf');
    expect(h.selected('office')).toBe('Berlin');
    expect(outcome.filledKnown).toBe(1);
    expect(outcome.guesses).toEqual([]);
    expect(outcome.freeform).toEqual([]);
  });

  it('replays a free-text answer verbatim and records a review-tier guess', async () => {
    await writeBank([approvedEntry('Describe your LLM experience', 'Built LLM-as-judge evals.')]);
    const h = harness([ESSAY], {});
    const outcome = await makeAts(h.cfg).fill(h.page, {}, '/tmp/resume.pdf');
    expect(h.fills('essay')).toEqual(['Built LLM-as-judge evals.']);
    expect(outcome.filledKnown).toBe(1);
    expect(outcome.guesses).toEqual([
      { fieldKey: 'essay', question: 'Describe your LLM experience', answer: 'Built LLM-as-judge evals.', reason: 'freeform' },
    ]);
  });

  it('a non-exact select replay is recorded as a guess', async () => {
    await writeBank([approvedEntry('Which office would you prefer', 'Berlin')]);
    const h = harness([OFFICE], { office: ['Berlin', 'London'] });
    const outcome = await makeAts(h.cfg).fill(h.page, {}, '/tmp/resume.pdf');
    expect(h.selected('office')).toBe('Berlin');
    expect(outcome.guesses).toEqual([
      { fieldKey: 'office', question: 'Which office would you prefer', answer: 'Berlin', reason: 'freeform' },
    ]);
  });

  it('leaves the field in the freeform handoff when the only entry is unapproved', async () => {
    await writeBank([{ ...approvedEntry('Describe your LLM experience', 'draft'), approved: false }]);
    const h = harness([ESSAY], {});
    const outcome = await makeAts(h.cfg).fill(h.page, {}, '/tmp/resume.pdf');
    expect(outcome.filledKnown).toBe(0);
    expect(outcome.freeform.map((q) => q.fieldKey)).toEqual(['essay']);
  });

  it('fills an unanswered toggle group from an exact bank answer (no guess)', async () => {
    const group: ChoiceGroup = {
      key: 'g1',
      label: 'Do you play the theremin professionally',
      required: true,
      kind: 'button',
      selectedSelector: '[class*="_act"]',
      checked: false,
      options: [
        { label: 'Yes', id: 'g1-yes', value: '' },
        { label: 'No', id: 'g1-no', value: '' },
      ],
    };
    await writeBank([approvedEntry('Do you play the theremin professionally', 'No', ['No', 'Yes'])]);
    const h = harness([], {}, [group]);
    const outcome = await makeAts(h.cfg).fill(h.page, {}, '/tmp/resume.pdf');
    expect(h.clicked('g1-no')).toBe(true);
    expect(outcome.filledKnown).toBe(1);
    expect(outcome.guesses).toEqual([]);
  });
});
