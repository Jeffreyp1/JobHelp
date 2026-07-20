import { readFile } from 'node:fs/promises';
import { log } from './log.ts';
import { selectorOverridesPath } from './paths.ts';
import { DEFAULT_REACT_SELECT, type AtsConfig, type ReactSelectClasses } from './ats/form-config.ts';

export interface SelectorOverride {
  readonly formSelector?: string;
  readonly submitSelector?: string;
  readonly toggleGroupSelector?: string;
  readonly reactSelect?: Partial<Pick<ReactSelectClasses, 'option' | 'noOptions' | 'singleValue' | 'loading'>>;
}

let loaded: Record<string, SelectorOverride> | null = null;

const STR_KEYS = ['formSelector', 'submitSelector', 'toggleGroupSelector'] as const;
const RS_KEYS = ['option', 'noOptions', 'singleValue', 'loading'] as const;

function parseOverride(raw: unknown, ats: string): SelectorOverride | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof SelectorOverride]: SelectorOverride[K] } = {};
  for (const k of STR_KEYS) {
    const v = r[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  const rs = r['reactSelect'];
  if (typeof rs === 'object' && rs !== null) {
    const rsIn = rs as Record<string, unknown>;
    const rsOut: Partial<Record<(typeof RS_KEYS)[number], string>> = {};
    for (const k of RS_KEYS) {
      const v = rsIn[k];
      if (typeof v === 'string' && v !== '') rsOut[k] = v;
    }
    if (Object.keys(rsOut).length > 0) out.reactSelect = rsOut;
  }
  if (Object.keys(out).length === 0) {
    log('warn', 'selector override has no usable fields; ignoring', { ats });
    return null;
  }
  return out;
}

export async function loadSelectorOverrides(path: string = selectorOverridesPath()): Promise<void> {
  if (loaded !== null) return;
  loaded = {};
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('warn', 'selector overrides file is not valid JSON; running on adapter defaults', { path });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const overrides = (parsed as Record<string, unknown>)['overrides'];
  if (typeof overrides !== 'object' || overrides === null) return;
  for (const [ats, o] of Object.entries(overrides as Record<string, unknown>)) {
    const v = parseOverride(o, ats);
    if (v !== null) loaded[ats] = v;
  }
}

export function resetSelectorOverridesForTest(): void {
  loaded = null;
}

export function hasSelectorOverride(ats: string): boolean {
  return loaded !== null && loaded[ats] !== undefined;
}

export function withSelectorOverrides(cfg: AtsConfig): AtsConfig {
  const o = loaded?.[cfg.name];
  if (o === undefined) return cfg;
  return {
    ...cfg,
    ...(o.formSelector !== undefined ? { formSelector: o.formSelector } : {}),
    ...(o.submitSelector !== undefined ? { submitSelector: o.submitSelector } : {}),
    ...(o.toggleGroupSelector !== undefined ? { toggleGroupSelector: o.toggleGroupSelector } : {}),
    ...(o.reactSelect !== undefined
      ? { reactSelect: { ...(cfg.reactSelect ?? DEFAULT_REACT_SELECT), ...o.reactSelect } }
      : {}),
  };
}
