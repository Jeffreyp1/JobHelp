export type MergeMode = 'defaults_only' | 'additive' | 'replace';

export interface RuleFile {
  readonly id: string;
  readonly filename: string;
  readonly content: string;
}

function sortByFilename(rules: readonly RuleFile[]): RuleFile[] {
  return [...rules].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
}

export function merge(
  defaults: readonly RuleFile[],
  user: readonly RuleFile[],
  mode: MergeMode,
): readonly RuleFile[] {
  if (mode === 'defaults_only') return Object.freeze(sortByFilename(defaults));
  if (mode === 'replace') return Object.freeze(sortByFilename(user));
  const byName = new Map<string, RuleFile>();
  for (const r of defaults) byName.set(r.filename, r);
  for (const r of user) byName.set(r.filename, r);
  return Object.freeze(sortByFilename(Array.from(byName.values())));
}
