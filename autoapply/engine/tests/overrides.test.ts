import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyLabelWithOverrides, setOverridesPath } from '../src/match.ts';

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
