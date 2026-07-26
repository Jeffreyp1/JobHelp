import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { detectControls } from '../src/ats/detect-controls.ts';
import { byKey } from '../src/ats/locate.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import type { AtsConfig, DetectedField, Surface } from '../src/ats/form-config.ts';

const g = globalThis as { CSS?: { escape(v: string): string } };
g.CSS ??= { escape: (v: string) => v };

interface FakeControl {
  tagName: string;
  type: string;
  required: boolean;
  placeholder: string;
  attrs: Record<string, string>;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  closest(sel: string): null;
  ownerDocument: { querySelector(sel: string): null; getElementById(id: string): null };
}

function control(init: { tag?: string; attrs?: Record<string, string>; failStamp?: boolean } = {}): FakeControl {
  const attrs = { ...(init.attrs ?? {}) };
  return {
    tagName: init.tag ?? 'INPUT',
    type: 'text',
    required: false,
    placeholder: attrs['placeholder'] ?? '',
    attrs,
    getAttribute: (n) => attrs[n] ?? null,
    setAttribute: (n, v) => {
      if (init.failStamp === true) throw new Error('setAttribute blocked');
      attrs[n] = v;
    },
    closest: () => null,
    ownerDocument: { querySelector: () => null, getElementById: () => null },
  };
}

function surfaceFor(els: FakeControl[]): Surface {
  const controlsLocator = {
    evaluateAll: (fn: (e: unknown[]) => unknown) => Promise.resolve(fn(els)),
  };
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['locator'] = (sel: string) => (sel === 'input, select, textarea' ? controlsLocator : form);
  return { locator: () => form } as unknown as Surface;
}

const CFG: AtsConfig = {
  name: 'fake',
  urlRe: /fake/,
  formSelector: 'form',
  submitSelector: 'button[type="submit"]',
  detect: detectControls,
};

describe('detectControls — keyless controls get a stable data-jobhelp-key', () => {
  it('stamps a key on a control with neither id nor name and returns it', async () => {
    const el = control({ attrs: { placeholder: 'Anything else?' } });
    const fields = await detectControls(surfaceFor([el]), CFG);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.id).toMatch(/^jobhelp-/);
    expect(el.attrs['data-jobhelp-key']).toBe(fields[0]?.id);
    expect(fields[0]?.label).toBe('Anything else?');
  });

  it('reuses the existing stamp on a second detection pass', async () => {
    const el = control();
    const surface = surfaceFor([el]);
    const first = await detectControls(surface, CFG);
    const second = await detectControls(surface, CFG);
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it('gives two keyless controls distinct keys', async () => {
    const a = control();
    const b = control();
    const fields = await detectControls(surfaceFor([a, b]), CFG);
    expect(fields).toHaveLength(2);
    expect(fields[0]?.id).not.toBe(fields[1]?.id);
  });

  it('leaves keyed controls alone', async () => {
    const el = control({ attrs: { id: 'email' } });
    const fields = await detectControls(surfaceFor([el]), CFG);
    expect(fields[0]?.id).toBe('email');
    expect(el.attrs['data-jobhelp-key']).toBeUndefined();
  });

  it('returns an unstampable control with an empty key instead of dropping it', async () => {
    const el = control({ failStamp: true, attrs: { placeholder: 'Mystery' } });
    const fields = await detectControls(surfaceFor([el]), CFG);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.id).toBe('');
  });
});

describe('byKey — resolves stamped keys', () => {
  it('matches [data-jobhelp-key=...] in addition to id and name', () => {
    let captured = '';
    const surface = {
      locator: (sel: string) => {
        captured = sel;
        return { first: () => ({}) };
      },
    } as unknown as Surface;
    byKey(surface, 'jobhelp-ab12cd34');
    expect(captured).toContain('[data-jobhelp-key="jobhelp-ab12cd34"]');
  });
});

function miniPage(): Page {
  const generic: Record<string, unknown> = {};
  generic['count'] = () => Promise.resolve(0);
  generic['first'] = () => generic;
  generic['locator'] = () => generic;
  const fileLocator = {
    elementHandles: () => Promise.resolve([]),
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn([])),
  };
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['locator'] = (sel: string) => (sel === 'input[type=file]' ? fileLocator : generic);
  form['evaluate'] = (fn: (r: unknown) => unknown) => Promise.resolve(fn({ querySelectorAll: () => [] }));
  return { locator: (sel: string) => (sel === 'form' ? form : generic) } as unknown as Page;
}

const UNKEYED: DetectedField = {
  id: '',
  label: 'Mystery question',
  tag: 'input',
  type: 'text',
  required: false,
  reactSelect: false,
};

function cfgWith(fields: DetectedField[]): AtsConfig {
  return { ...CFG, detect: async () => fields };
}

describe('makeAts — an unkeyable control fails the gate closed', () => {
  it('validate surfaces it as a blocker even when not marked required', async () => {
    const ats = makeAts(cfgWith([UNKEYED]));
    const validation = await ats.validate(miniPage());
    expect(validation.ok).toBe(false);
    expect(validation.blockers).toContain('Mystery question');
  });

  it('fill skips it without handing off an unlocatable freeform question', async () => {
    const ats = makeAts(cfgWith([UNKEYED]));
    const outcome = await ats.fill(miniPage(), {}, '/tmp/resume.pdf');
    expect(outcome.freeform).toEqual([]);
    expect(outcome.filledKnown).toBe(0);
  });
});
