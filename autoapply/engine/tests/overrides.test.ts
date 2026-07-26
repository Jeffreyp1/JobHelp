import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import {
  classifyLabel,
  classifyLabelWithOverrides,
  classifyLabelWithRules,
  loadLabelOverrides,
  setOverridesPath,
} from '../src/match.ts';
import { resetAnswerBankCache } from '../src/answer-bank.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import type { AtsConfig, DetectedField } from '../src/ats/form-config.ts';
import type { ChoiceGroup } from '../src/ats/choice-groups.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'overrides-test-'));
});

async function writeOverrides(dir: string, content: unknown): Promise<string> {
  const p = join(dir, 'overrides.json');
  await writeFile(p, JSON.stringify(content));
  return p;
}

describe('classifyLabelWithOverrides', () => {
  it('matches a valid override rule before built-ins', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: 'years of experience', flags: 'i', concept: 'howHeard', ats: null, addedAt: '2026-01-01', evidence: 'test' },
      ],
    });
    setOverridesPath(p);
    const result = await classifyLabelWithOverrides('Years of experience', null);
    expect(result).toBe('howHeard');
  });

  it('ats-scoped rule only matches its own ats', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: 'magic question', flags: 'i', concept: 'email', ats: 'greenhouse', addedAt: '2026-01-01', evidence: '' },
      ],
    });
    setOverridesPath(p);
    const forGreenhouse = await classifyLabelWithOverrides('magic question', 'greenhouse');
    expect(forGreenhouse).toBe('email');
    const forLever = await classifyLabelWithOverrides('magic question', 'lever');
    expect(forLever).toBeNull();
  });

  it('ats null rule matches any ats', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: 'custom label', flags: 'i', concept: 'phone', ats: null, addedAt: '2026-01-01', evidence: '' },
      ],
    });
    setOverridesPath(p);
    expect(await classifyLabelWithOverrides('custom label', 'ashby')).toBe('phone');
    expect(await classifyLabelWithOverrides('custom label', null)).toBe('phone');
  });

  it('accepts a learned rule targeting a newly added concept', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: 'open to moving', flags: 'i', concept: 'relocation', ats: null, addedAt: '2026-07-16', evidence: '' },
      ],
    });
    setOverridesPath(p);
    expect(await classifyLabelWithOverrides('Are you open to moving for this role?', null)).toBe('relocation');
  });

  it('skips a rule with an invalid concept and falls through to built-ins', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: 'first name', flags: 'i', concept: 'notAValidConcept', ats: null, addedAt: '2026-01-01', evidence: '' },
      ],
    });
    setOverridesPath(p);
    const result = await classifyLabelWithOverrides('first name', null);
    expect(result).toBe('firstName');
  });

  it('skips a rule with a malformed regex', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [
        { pattern: '[invalid(regex', flags: '', concept: 'email', ats: null, addedAt: '2026-01-01', evidence: '' },
        { pattern: 'email', flags: 'i', concept: 'email', ats: null, addedAt: '2026-01-01', evidence: '' },
      ],
    });
    setOverridesPath(p);
    const result = await classifyLabelWithOverrides('email', null);
    expect(result).toBe('email');
  });

  it('tolerates a missing overrides file and falls through to built-ins', async () => {
    setOverridesPath(join(tmpDir, 'does-not-exist.json'));
    const result = await classifyLabelWithOverrides('email address', null);
    expect(result).toBe('email');
  });

  it('tolerates an unparseable overrides file and falls through to built-ins', async () => {
    const p = join(tmpDir, 'bad.json');
    await writeFile(p, 'not json at all');
    setOverridesPath(p);
    const result = await classifyLabelWithOverrides('phone number', null);
    expect(result).toBe('phone');
  });

  it('returns null when no rule and no built-in matches', async () => {
    const p = await writeOverrides(tmpDir, { labelRules: [] });
    setOverridesPath(p);
    const result = await classifyLabelWithOverrides('xyzzy mystery field', null);
    expect(result).toBeNull();
  });
});

describe('classifyLabelWithRules (sync, load-once)', () => {
  it('uses built-ins only until loadLabelOverrides has run', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'custom label', flags: 'i', concept: 'phone', ats: null }],
    });
    setOverridesPath(p);
    expect(classifyLabelWithRules('custom label', null)).toBeNull();
    await loadLabelOverrides();
    expect(classifyLabelWithRules('custom label', null)).toBe('phone');
  });

  it('a learned rule wins over a built-in', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'first name', flags: 'i', concept: 'email', ats: null }],
    });
    setOverridesPath(p);
    await loadLabelOverrides();
    expect(classifyLabel('First name')).toBe('firstName');
    expect(classifyLabelWithRules('First name', null)).toBe('email');
  });

  it('scopes rules by ats and falls back to built-ins otherwise', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'magic question', flags: 'i', concept: 'email', ats: 'greenhouse' }],
    });
    setOverridesPath(p);
    await loadLabelOverrides();
    expect(classifyLabelWithRules('magic question', 'greenhouse')).toBe('email');
    expect(classifyLabelWithRules('magic question', 'lever')).toBeNull();
  });

  it('a g-flagged rule matches consistently across repeated calls', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'custom label', flags: 'gi', concept: 'phone', ats: null }],
    });
    setOverridesPath(p);
    await loadLabelOverrides();
    expect(classifyLabelWithRules('custom label', null)).toBe('phone');
    expect(classifyLabelWithRules('custom label', null)).toBe('phone');
  });
});

interface Harness {
  readonly page: Page;
  readonly cfg: AtsConfig;
  readonly batches: Array<Array<{ key: string; value: string }>>;
  readonly clicked: (key: string) => boolean;
}

function harness(fields: DetectedField[], toggles: ChoiceGroup[] = []): Harness {
  const batches: Array<Array<{ key: string; value: string }>> = [];
  const clicked = new Set<string>();
  const controls = new Map<string, Record<string, unknown>>();
  for (const f of fields) {
    const loc: Record<string, unknown> = {};
    let value = '';
    loc['first'] = () => loc;
    loc['fill'] = (v: string) => Promise.resolve(void (value = v));
    loc['inputValue'] = () => Promise.resolve(value);
    controls.set(f.id, loc);
  }
  for (const g of toggles) {
    for (const o of g.options) {
      const loc: Record<string, unknown> = {};
      loc['first'] = () => loc;
      loc['click'] = () => Promise.resolve(void clicked.add(o.id));
      loc['evaluate'] = () => Promise.resolve(clicked.has(o.id));
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
  form['evaluate'] = (fn: (r: unknown) => unknown, arg?: Array<{ key: string; value: string }>) => {
    if (arg === undefined) return Promise.resolve(fn({ querySelectorAll: () => [] }));
    batches.push(arg);
    return Promise.resolve(arg.map((e) => e.key));
  };
  const cfg: AtsConfig = {
    name: 'fake',
    urlRe: /fake/,
    formSelector: 'form',
    submitSelector: 'button[type=submit]',
    detect: async () => fields,
    ...(toggles.length > 0 ? { detectToggleGroups: async () => toggles } : {}),
  };
  const page = {
    locator: (sel: string) => (sel === 'form' ? form : dispatch(sel)),
    goto: () => Promise.resolve(null),
    waitForLoadState: () => Promise.resolve(),
  } as unknown as Page;
  return { page, cfg, batches, clicked: (key) => clicked.has(key) };
}

describe('makeAts fill classifies with learned overrides', () => {
  const WIZARD: DetectedField = {
    id: 'wiz',
    label: 'Wizard Level',
    tag: 'input',
    type: 'text',
    required: false,
    reactSelect: false,
  };
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env['JOBHELP_HOME'];
    process.env['JOBHELP_HOME'] = tmpDir;
    resetAnswerBankCache();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    resetAnswerBankCache();
  });

  it('fills a text field whose label only a learned rule classifies', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'wizard level', flags: 'i', concept: 'github', ats: null }],
    });
    setOverridesPath(p);
    const h = harness([WIZARD]);
    const outcome = await makeAts(h.cfg).fill(h.page, { github: 'https://github.com/jeff' }, '/tmp/resume.pdf');
    expect(h.batches).toEqual([[{ key: 'wiz', value: 'https://github.com/jeff' }]]);
    expect(outcome.filledKnown).toBe(1);
  });

  it('does not apply a rule scoped to a different ats', async () => {
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'wizard level', flags: 'i', concept: 'github', ats: 'greenhouse' }],
    });
    setOverridesPath(p);
    const h = harness([WIZARD]);
    const outcome = await makeAts(h.cfg).fill(h.page, { github: 'https://github.com/jeff' }, '/tmp/resume.pdf');
    expect(h.batches).toEqual([]);
    expect(outcome.freeform.map((q) => q.fieldKey)).toEqual(['wiz']);
  });

  it('classifies choice groups through learned rules too', async () => {
    const group: ChoiceGroup = {
      key: 'g1',
      label: 'Crystal preference',
      required: true,
      kind: 'button',
      selectedSelector: '[class*="_act"]',
      checked: false,
      options: [
        { label: 'Yes', id: 'g1-yes', value: '' },
        { label: 'No', id: 'g1-no', value: '' },
      ],
    };
    const p = await writeOverrides(tmpDir, {
      labelRules: [{ pattern: 'crystal preference', flags: 'i', concept: 'relocation', ats: null }],
    });
    setOverridesPath(p);
    const h = harness([], [group]);
    const outcome = await makeAts(h.cfg).fill(h.page, { relocation: 'Yes' }, '/tmp/resume.pdf');
    expect(h.clicked('g1-yes')).toBe(true);
    expect(outcome.filledKnown).toBe(1);
  });
});
