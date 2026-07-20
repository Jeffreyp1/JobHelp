import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { makeAts } from '../src/ats/make-ats.ts';
import { DEFAULT_REACT_SELECT, type AtsConfig, type DetectedField } from '../src/ats/form-config.ts';

interface OrchestrationOpts {
  fields: DetectedField[];
  values: Record<string, string>;
  batchLanded?: (keys: string[]) => string[];
  controlCount?: () => number;
}

interface Orchestration {
  page: Page;
  batchCalls: Array<Array<{ key: string; value: string }>>;
  detectCalls: () => number;
  cfg: AtsConfig;
  fills: (key: string) => string[];
}

function textControl(): { loc: Record<string, unknown>; fills: string[] } {
  const fills: string[] = [];
  let value = '';
  const optionLocator = {
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn([])),
  };
  const loc: Record<string, unknown> = {};
  loc['first'] = () => loc;
  loc['click'] = () => Promise.resolve();
  loc['press'] = () => Promise.resolve();
  loc['locator'] = () => optionLocator;
  loc['fill'] = (v: string) => {
    fills.push(v);
    value = v;
    return Promise.resolve();
  };
  loc['inputValue'] = () => Promise.resolve(value);
  loc['evaluate'] = (fn: (el: unknown) => unknown) =>
    Promise.resolve(fn({ tagName: 'INPUT', getAttribute: () => null }));
  return { loc, fills };
}

function orchestration(opts: OrchestrationOpts): Orchestration {
  const batchCalls: Array<Array<{ key: string; value: string }>> = [];
  const controls = new Map<string, ReturnType<typeof textControl>>();
  for (const f of opts.fields) controls.set(f.id, textControl());
  const root = { querySelectorAll: () => [] };
  const generic: Record<string, unknown> = {};
  generic['count'] = () => Promise.resolve(0);
  generic['first'] = () => generic;
  generic['locator'] = () => generic;
  generic['isVisible'] = () => Promise.resolve(false);
  const dispatch = (sel: string): unknown => {
    for (const [key, ctl] of controls) {
      if (sel.includes(`"${key}"`)) return ctl.loc;
    }
    return generic;
  };
  const fileLocator = {
    elementHandles: () => Promise.resolve([]),
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn([])),
  };
  const countLocator = { count: () => Promise.resolve(opts.controlCount?.() ?? opts.fields.length) };
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['waitFor'] = () => Promise.resolve();
  form['locator'] = (sel: string) => {
    if (sel === 'input[type=file]') return fileLocator;
    if (sel === 'input, select, textarea') return countLocator;
    return dispatch(sel);
  };
  form['evaluate'] = (fn: (r: unknown) => unknown, arg?: Array<{ key: string; value: string }>) => {
    if (arg === undefined) return Promise.resolve(fn(root));
    batchCalls.push(arg);
    return Promise.resolve((opts.batchLanded ?? ((keys: string[]) => keys))(arg.map((e) => e.key)));
  };
  let detectCalls = 0;
  const cfg: AtsConfig = {
    name: 'fake',
    urlRe: /fake/,
    formSelector: 'form',
    submitSelector: 'button[type=submit]',
    // Keep the combobox menu probe near-instant: the fake surface never shows a
    // menu, so the default budget would just be slept away.
    reactSelect: { ...DEFAULT_REACT_SELECT, probeBudgetMs: 1 },
    detect: async () => {
      detectCalls += 1;
      return opts.fields;
    },
    resolveValue: (field) => opts.values[field.id],
  };
  const page = {
    locator: (sel: string) => (sel === 'form' ? form : dispatch(sel)),
    goto: () => Promise.resolve(null),
    waitForLoadState: () => Promise.resolve(),
  } as unknown as Page;
  return {
    page,
    batchCalls,
    detectCalls: () => detectCalls,
    cfg,
    fills: (key: string) => controls.get(key)?.fills ?? [],
  };
}

function textField(id: string, label = id): DetectedField {
  return { id, label, tag: 'input', type: 'text', required: false, reactSelect: false };
}

describe('makeAts fill — batching orchestration', () => {
  it('sends all plain text fields in one batch and skips per-field fills for landed keys', async () => {
    const o = orchestration({
      fields: [textField('fname'), textField('lname')],
      values: { fname: 'Jane', lname: 'Doe' },
    });
    const outcome = await makeAts(o.cfg).fill(o.page, {}, '/tmp/resume.pdf');
    expect(o.batchCalls).toEqual([
      [
        { key: 'fname', value: 'Jane' },
        { key: 'lname', value: 'Doe' },
      ],
    ]);
    expect(o.fills('fname')).toEqual([]);
    expect(o.fills('lname')).toEqual([]);
    expect(outcome.filledKnown).toBe(2);
  });

  it('falls back to the per-field fill for exactly the keys whose value did not stick', async () => {
    const o = orchestration({
      fields: [textField('fname'), textField('lname')],
      values: { fname: 'Jane', lname: 'Doe' },
      batchLanded: (keys) => keys.filter((k) => k === 'fname'),
    });
    const outcome = await makeAts(o.cfg).fill(o.page, {}, '/tmp/resume.pdf');
    expect(o.fills('fname')).toEqual([]);
    expect(o.fills('lname')).toEqual(['Doe']);
    expect(outcome.filledKnown).toBe(2);
  });

  it('keeps selects and comboboxes out of the batch', async () => {
    const combo: DetectedField = { id: 'cc', label: 'cc', tag: 'input', type: 'text', required: false, reactSelect: true };
    const sel: DetectedField = { id: 'ss', label: 'ss', tag: 'select', type: 'select', required: false, reactSelect: false };
    const o = orchestration({
      fields: [textField('fname'), combo, sel],
      values: { fname: 'Jane' },
    });
    const outcome = await makeAts(o.cfg).fill(o.page, {}, '/tmp/resume.pdf');
    expect(o.batchCalls).toEqual([[{ key: 'fname', value: 'Jane' }]]);
    expect(outcome.freeform.map((q) => q.fieldKey).sort()).toEqual(['cc', 'ss']);
  });

  it('makes no batch call when nothing is batchable', async () => {
    const sel: DetectedField = { id: 'ss', label: 'ss', tag: 'select', type: 'select', required: false, reactSelect: false };
    const o = orchestration({ fields: [sel], values: {} });
    await makeAts(o.cfg).fill(o.page, {}, '/tmp/resume.pdf');
    expect(o.batchCalls).toEqual([]);
  });
});

describe('makeAts validate — reuses the fill-time detection', () => {
  it('does not re-detect when the control count is stable and no answers were applied', async () => {
    const o = orchestration({ fields: [textField('fname')], values: { fname: 'Jane' } });
    const ats = makeAts(o.cfg);
    await ats.fill(o.page, {}, '/tmp/resume.pdf');
    expect(o.detectCalls()).toBe(1);
    const validation = await ats.validate(o.page);
    expect(o.detectCalls()).toBe(1);
    expect(validation.ok).toBe(true);
  });

  it('re-detects after a freeform answer was applied', async () => {
    const o = orchestration({ fields: [textField('fname'), textField('q1')], values: { fname: 'Jane' } });
    const ats = makeAts(o.cfg);
    await ats.fill(o.page, {}, '/tmp/resume.pdf');
    const applied = await ats.applyFreeform(o.page, { q1: 'my answer' });
    expect(applied).toEqual(['q1']);
    await ats.validate(o.page);
    expect(o.detectCalls()).toBe(2);
  });

  it('re-detects when the fillable control count changed', async () => {
    let count = 2;
    const o = orchestration({
      fields: [textField('fname')],
      values: { fname: 'Jane' },
      controlCount: () => count,
    });
    const ats = makeAts(o.cfg);
    await ats.fill(o.page, {}, '/tmp/resume.pdf');
    count = 3;
    await ats.validate(o.page);
    expect(o.detectCalls()).toBe(2);
  });

  it('re-detects after openForm navigated the page even with a stable count', async () => {
    const o = orchestration({ fields: [textField('fname')], values: { fname: 'Jane' } });
    const ats = makeAts(o.cfg);
    await ats.fill(o.page, {}, '/tmp/resume.pdf');
    await ats.openForm(o.page, 'https://fake.test/next');
    await ats.validate(o.page);
    expect(o.detectCalls()).toBe(2);
  });
});
