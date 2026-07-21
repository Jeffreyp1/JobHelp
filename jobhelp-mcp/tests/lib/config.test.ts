import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig, interpolateEnv } from '../../core/lib/config.js';
import { isErr, isOk } from '../../core/types/result.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, '..', 'fixtures');

describe('interpolateEnv', () => {
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    prev = {
      JOBHELP_TEST_VAR_A: process.env['JOBHELP_TEST_VAR_A'],
      JOBHELP_TEST_VAR_B: process.env['JOBHELP_TEST_VAR_B'],
    };
    process.env['JOBHELP_TEST_VAR_A'] = 'aaa';
    process.env['JOBHELP_TEST_VAR_B'] = 'bbb';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('replaces ${VAR} in strings with process.env[VAR]', () => {
    expect(interpolateEnv('${JOBHELP_TEST_VAR_A}')).toBe('aaa');
    expect(interpolateEnv('prefix-${JOBHELP_TEST_VAR_A}-suffix')).toBe('prefix-aaa-suffix');
    expect(interpolateEnv('${JOBHELP_TEST_VAR_A}/${JOBHELP_TEST_VAR_B}')).toBe('aaa/bbb');
  });

  it('replaces unset variables with empty string', () => {
    expect(interpolateEnv('${JOBHELP_TEST_VAR_DOES_NOT_EXIST}')).toBe('');
    expect(interpolateEnv('a${JOBHELP_TEST_VAR_DOES_NOT_EXIST}b')).toBe('ab');
  });

  it('walks objects recursively', () => {
    const result = interpolateEnv({
      a: '${JOBHELP_TEST_VAR_A}',
      nested: { b: '${JOBHELP_TEST_VAR_B}' },
    });
    expect(result).toEqual({ a: 'aaa', nested: { b: 'bbb' } });
  });

  it('walks arrays recursively', () => {
    const result = interpolateEnv(['${JOBHELP_TEST_VAR_A}', { x: '${JOBHELP_TEST_VAR_B}' }]);
    expect(result).toEqual(['aaa', { x: 'bbb' }]);
  });

  it('leaves non-string primitives untouched', () => {
    expect(interpolateEnv(42)).toBe(42);
    expect(interpolateEnv(true)).toBe(true);
    expect(interpolateEnv(null)).toBe(null);
    expect(interpolateEnv(undefined)).toBe(undefined);
  });

  it('leaves strings without ${VAR} placeholders untouched', () => {
    expect(interpolateEnv('plain text')).toBe('plain text');
    expect(interpolateEnv('has $ but not interpolation')).toBe('has $ but not interpolation');
  });
});

describe('loadConfig', () => {
  it('loads + validates a well-formed config', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-valid.json'));
    if (!isOk(result)) {
      throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
    }
    const c = result.value;
    expect(c.profile.skills).toEqual(['typescript', 'go', 'python']);
    expect(c.profile.location).toBe('Austin, TX');
    expect(c.profile.salaryFloor).toBe(100000);
    expect(c.profile.seniority).toBe('entry');
    expect(c.profile.roleFamily).toEqual(['backend', 'fullstack']);
    expect(c.ranking.topN).toBe(20);
    expect(c.ranking.digestK).toBe(10);
    expect(c.sources.adzuna?.country).toBe('us');
    expect(c.sources.greenhouse?.tokens).toEqual(['doordash', 'stripe']);
    expect(c.sources.lever?.slugs).toEqual(['plaid', 'anthropic']);
  });

  it('passes profile.allowedCountries through when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'allowed-countries.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'entry',
            roleFamily: ['backend'],
            allowedCountries: ['US'],
          },
          ranking: { topN: 1, digestK: 1 },
          output: { dir: '/tmp' },
        }),
      );
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.profile.allowedCountries).toEqual(['US']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves profile.allowedCountries undefined when omitted', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-valid.json'));
    if (!isOk(result)) throw new Error('expected ok');
    expect(result.value.profile.allowedCountries).toBeUndefined();
  });

  it('loads rules block with mode and userRulesDir', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-valid.json'));
    if (!isOk(result)) throw new Error('expected ok');
    expect(result.value.rules.mode).toBe('additive');
    expect(result.value.rules.userRulesDir).not.toContain('~');
    expect(result.value.rules.userRulesDir).toContain('jobhelp');
  });

  it('expands ~ in resumeDumpPath, output.dir, and rules.userRulesDir', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-valid.json'));
    if (!isOk(result)) throw new Error('expected ok');
    expect(result.value.profile.resumeDumpPath.startsWith('~')).toBe(false);
    expect(result.value.output.dir.startsWith('~')).toBe(false);
    expect(result.value.rules.userRulesDir.startsWith('~')).toBe(false);
  });

  it('does not include an anthropic block', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-valid.json'));
    if (!isOk(result)) throw new Error('expected ok');
    expect(Object.prototype.hasOwnProperty.call(result.value, 'anthropic')).toBe(false);
  });

  it('defaults rules block when omitted from file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'no-rules.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'entry',
            roleFamily: ['backend'],
          },
          ranking: { topN: 1, digestK: 1 },
          output: { dir: '/tmp' },
        }),
      );
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.rules.mode).toBe('additive');
      expect(result.value.rules.userRulesDir).toBe(join(homedir(), 'jobhelp', 'rules'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults ranking block when omitted from file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'no-ranking.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'entry',
            roleFamily: ['backend'],
          },
          output: { dir: '/tmp' },
        }),
      );
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.ranking.topN).toBe(20);
      expect(result.value.ranking.digestK).toBe(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns not_found error when file is missing', async () => {
    const result = await loadConfig('/tmp/jobhelp-test-does-not-exist-9c8f7e6d.json');
    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('not_found');
    expect(result.error.message.toLowerCase()).toContain('not found');
  });

  it('returns parse error on malformed JSON', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-invalid-parse-error.json'));
    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('parse');
    expect(result.error.message.toLowerCase()).toContain('parse');
  });

  it('returns validation error when profile block is missing', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-invalid-missing-field.json'));
    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('validation');
    expect(result.error.message).toContain('profile');
  });

  it('returns validation error when a field has wrong type', async () => {
    const result = await loadConfig(join(FIXTURES, 'config-invalid-wrong-type.json'));
    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('validation');
    expect(result.error.message.toLowerCase()).toContain('string');
  });

  it('returns validation error when seniority is not one of the allowed values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'bad-seniority.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'expert',
            roleFamily: ['backend'],
          },
          ranking: { topN: 1, digestK: 1 },
          output: { dir: '/tmp' },
        }),
      );
      const result = await loadConfig(p);
      if (!isErr(result)) throw new Error('expected err');
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toContain('seniority');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns validation error when rules.mode is invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'bad-rules-mode.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'entry',
            roleFamily: ['backend'],
          },
          output: { dir: '/tmp' },
          rules: { mode: 'bogus_mode' },
        }),
      );
      const result = await loadConfig(p);
      if (!isErr(result)) throw new Error('expected err');
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toContain('rules.mode');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats sources block as optional', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-test-'));
    try {
      const p = join(dir, 'no-sources.json');
      writeFileSync(
        p,
        JSON.stringify({
          profile: {
            resumeDumpPath: '/tmp/r.md',
            skills: ['ts'],
            location: 'X',
            remoteOk: true,
            salaryFloor: 1,
            seniority: 'entry',
            roleFamily: ['backend'],
          },
          ranking: { topN: 1, digestK: 1 },
          output: { dir: '/tmp' },
        }),
      );
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error('expected ok');
      expect(result.value.sources).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
