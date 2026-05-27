import { describe, it, expect } from 'vitest';
import { merge, type MergeMode, type RuleFile } from '../../core/rules/merger.js';

function rule(filename: string, content: string): RuleFile {
  return { id: filename.replace(/\.md$/, ''), filename, content };
}

describe('merge', () => {
  const defaults: readonly RuleFile[] = [
    rule('01-priority.md', 'default-1'),
    rule('02-fab.md', 'default-2'),
  ];
  const user: readonly RuleFile[] = [
    rule('02-fab.md', 'user-2-override'),
    rule('99-extra.md', 'user-extra'),
  ];

  it('defaults_only ignores user rules entirely', () => {
    const out = merge(defaults, user, 'defaults_only');
    expect(out.map((r) => r.filename)).toEqual(['01-priority.md', '02-fab.md']);
    expect(out.find((r) => r.filename === '02-fab.md')?.content).toBe('default-2');
    expect(out.find((r) => r.filename === '99-extra.md')).toBeUndefined();
  });

  it('replace returns user only (empty input → empty output)', () => {
    const out = merge(defaults, user, 'replace');
    expect(out.map((r) => r.filename)).toEqual(['02-fab.md', '99-extra.md']);
    const empty = merge(defaults, [], 'replace');
    expect(empty.length).toBe(0);
  });

  it('additive merges defaults + user, user wins on filename match, sorted', () => {
    const out = merge(defaults, user, 'additive');
    expect(out.map((r) => r.filename)).toEqual([
      '01-priority.md',
      '02-fab.md',
      '99-extra.md',
    ]);
    expect(out.find((r) => r.filename === '02-fab.md')?.content).toBe('user-2-override');
    expect(out.find((r) => r.filename === '01-priority.md')?.content).toBe('default-1');
    expect(out.find((r) => r.filename === '99-extra.md')?.content).toBe('user-extra');
  });

  it('additive with no user rules equals defaults', () => {
    const out = merge(defaults, [], 'additive');
    expect(out.map((r) => r.filename)).toEqual(['01-priority.md', '02-fab.md']);
  });

  it('returns immutable arrays (frozen)', () => {
    const out = merge(defaults, user, 'additive');
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('handles all three modes via union type', () => {
    const modes: readonly MergeMode[] = ['defaults_only', 'additive', 'replace'];
    for (const mode of modes) {
      const out = merge(defaults, user, mode);
      expect(Array.isArray(out)).toBe(true);
    }
  });
});
