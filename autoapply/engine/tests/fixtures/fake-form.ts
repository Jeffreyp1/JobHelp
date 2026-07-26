import type { Page } from 'playwright';
import type { AtsConfig, DetectedField } from '../../src/ats/form-config.ts';

const g = globalThis as { CSS?: { escape(v: string): string } };
g.CSS ??= { escape: (v: string) => v };

export interface FakeFileInput {
  attrs: Record<string, string>;
  files: string[];
  uploads: string[];
}

export function fileInput(attrs: Record<string, string> = {}): FakeFileInput {
  return { attrs, files: [], uploads: [] };
}

function domFileEl(f: FakeFileInput): unknown {
  return {
    getAttribute: (n: string) => f.attrs[n] ?? null,
    closest: () => null,
    ownerDocument: { querySelector: () => null },
    files: f.files,
  };
}

function handleFor(f: FakeFileInput): unknown {
  return {
    evaluate: (fn: (el: unknown) => unknown) => Promise.resolve(fn(domFileEl(f))),
    setInputFiles: (p: string) => {
      f.uploads.push(p);
      f.files = [p];
      return Promise.resolve();
    },
  };
}

export interface FakeRoot {
  querySelectorAll(sel: string): unknown[];
}

export function fakePage(opts: {
  files?: FakeFileInput[];
  controls?: Record<string, unknown>;
  root?: FakeRoot;
} = {}): Page {
  const files = opts.files ?? [];
  const root: FakeRoot = opts.root ?? { querySelectorAll: () => [] };
  const generic: Record<string, unknown> = {};
  generic['count'] = () => Promise.resolve(0);
  generic['first'] = () => generic;
  generic['locator'] = () => generic;
  const fileLocator = {
    elementHandles: () => Promise.resolve(files.map(handleFor)),
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn(files.map(domFileEl))),
  };
  const dispatch = (sel: string): unknown => {
    for (const [key, loc] of Object.entries(opts.controls ?? {})) {
      if (sel.includes(`"${key}"`)) return loc;
    }
    return generic;
  };
  const form: Record<string, unknown> = {};
  form['count'] = () => Promise.resolve(1);
  form['first'] = () => form;
  form['locator'] = (sel: string) => (sel === 'input[type=file]' ? fileLocator : dispatch(sel));
  form['evaluate'] = (fn: (r: FakeRoot) => unknown) => Promise.resolve(fn(root));
  return {
    locator: (sel: string) => (sel === 'form' ? form : dispatch(sel)),
  } as unknown as Page;
}

export function testCfg(fields: DetectedField[] = []): AtsConfig {
  return {
    name: 'fake',
    urlRe: /fake/,
    formSelector: 'form',
    submitSelector: 'button[type="submit"]',
    detect: async () => fields,
  };
}

export function nativeSelect(options: readonly string[]): { loc: unknown; selected: () => string } {
  let selected = '';
  const optionEls = options.map((t) => ({ value: t, textContent: t }));
  const optionLocator = {
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn(optionEls)),
  };
  const loc: Record<string, unknown> = {};
  loc['first'] = () => loc;
  loc['locator'] = (sel: string) => (sel === 'option' ? optionLocator : loc);
  loc['selectOption'] = (v: { label?: string }) => {
    if (!options.includes(v.label ?? '')) return Promise.reject(new Error('no such option'));
    selected = v.label ?? '';
    return Promise.resolve([selected]);
  };
  loc['inputValue'] = () => Promise.resolve(selected);
  return { loc, selected: () => selected };
}
