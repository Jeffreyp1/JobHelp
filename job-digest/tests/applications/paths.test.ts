import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildApplicationDir,
  buildApplicationDirName,
  getApplicationsRoot,
  parseApplicationDirName,
} from '../../core/applications/paths.js';

describe('buildApplicationDirName', () => {
  it('joins company-slug, role-slug, and YYYY-MM-DD', () => {
    const name = buildApplicationDirName({
      company: 'DoorDash',
      role: 'Software Engineer I',
      date: '2026-05-15',
    });
    expect(name).toBe('doordash-software-engineer-i-2026-05-15');
  });

  it('normalizes punctuation in inputs', () => {
    const name = buildApplicationDirName({
      company: 'OpenAI, Inc.',
      role: 'AI/ML Engineer',
      date: '2026-01-02',
    });
    expect(name).toBe('openai-inc-ai-ml-engineer-2026-01-02');
  });

  it('throws on malformed date', () => {
    expect(() =>
      buildApplicationDirName({ company: 'Foo', role: 'Bar', date: '2026/05/15' }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      buildApplicationDirName({ company: 'Foo', role: 'Bar', date: '2026-5-15' }),
    ).toThrow();
  });

  it('throws when company slug normalizes to empty', () => {
    expect(() =>
      buildApplicationDirName({ company: '!!!', role: 'Bar', date: '2026-05-15' }),
    ).toThrow(/company slug is empty/);
  });

  it('throws when role slug normalizes to empty', () => {
    expect(() =>
      buildApplicationDirName({ company: 'Foo', role: '   ', date: '2026-05-15' }),
    ).toThrow(/role slug is empty/);
  });
});

describe('buildApplicationDir + getApplicationsRoot', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-paths-'));
    prevHome = process.env['JOBHELP_HOME'];
    process.env['JOBHELP_HOME'] = tmp;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('roots at $JOBHELP_HOME/applications', () => {
    expect(getApplicationsRoot()).toBe(join(tmp, 'applications'));
  });

  it('joins root with dir name', () => {
    const dir = buildApplicationDir({
      company: 'Stripe',
      role: 'Backend',
      date: '2026-05-15',
    });
    expect(dir).toBe(join(tmp, 'applications', 'stripe-backend-2026-05-15'));
  });
});

describe('parseApplicationDirName', () => {
  it('parses well-formed names', () => {
    expect(parseApplicationDirName('doordash-swe-i-2026-05-15')).toEqual({
      slug: 'doordash-swe-i',
      date: '2026-05-15',
    });
  });

  it('returns null for invalid names', () => {
    expect(parseApplicationDirName('no-date')).toBeNull();
    expect(parseApplicationDirName('not-a-date-suffix-9999')).toBeNull();
    expect(parseApplicationDirName('2026-05-15')).toBeNull();
  });
});
