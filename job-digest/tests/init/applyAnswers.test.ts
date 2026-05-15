import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyConfigAnswers } from '../../core/init/applyAnswers.js';
import { isOk, isErr } from '../../core/types/result.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'jobhelp-apply-test-'));
}

const MINIMAL_ANSWERS: Record<string, unknown> = {
  'profile.location': 'Austin, TX',
  'profile.skills': ['typescript', 'go'],
  'profile.salaryFloor': 100000,
  'profile.seniority': 'entry',
  'profile.roleFamily': ['backend'],
  'profile.resumeDumpPath': '~/Documents/resume.md',
  'profile.remoteOk': true,
  'output.dir': '~/jobhelp/digests',
  'rules.mode': 'additive',
  'rules.userRulesDir': '~/jobhelp/rules',
};

describe('applyConfigAnswers', () => {
  it('writes config.json to the given path and returns that path', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const result = await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.path).toBe(configPath);
      expect(existsSync(configPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('written JSON contains profile fields from answers', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        profile: {
          location: 'Austin, TX',
          skills: ['typescript', 'go'],
          salaryFloor: 100000,
          seniority: 'entry',
          roleFamily: ['backend'],
          resumeDumpPath: '~/Documents/resume.md',
          remoteOk: true,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('written JSON contains output and rules from answers', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        output: { dir: '~/jobhelp/digests' },
        rules: { mode: 'additive', userRulesDir: '~/jobhelp/rules' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('written JSON never contains an anthropic block', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const answers = {
        ...MINIMAL_ANSWERS,
        'anthropic.apiKey': 'sk-ant-should-not-appear',
      };
      await applyConfigAnswers({ answers, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(written, 'anthropic')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes optional adzuna block when provided', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const answers = {
        ...MINIMAL_ANSWERS,
        'sources.adzuna.appId': 'my-app-id',
        'sources.adzuna.appKey': 'my-app-key',
        'sources.adzuna.country': 'us',
      };
      await applyConfigAnswers({ answers, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        sources: {
          adzuna: { appId: 'my-app-id', appKey: 'my-app-key', country: 'us' },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes optional greenhouse block when provided', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const answers = {
        ...MINIMAL_ANSWERS,
        'sources.greenhouse.tokens': ['doordash', 'stripe'],
      };
      await applyConfigAnswers({ answers, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        sources: { greenhouse: { tokens: ['doordash', 'stripe'] } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes optional lever block when provided', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const answers = {
        ...MINIMAL_ANSWERS,
        'sources.lever.slugs': ['plaid', 'anthropic'],
      };
      await applyConfigAnswers({ answers, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        sources: { lever: { slugs: ['plaid', 'anthropic'] } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'nested', 'deep', 'config.json');
      const result = await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(existsSync(configPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns write_error when outputPath is not writable', async () => {
    const result = await applyConfigAnswers({
      answers: MINIMAL_ANSWERS,
      outputPath: '/proc/sys/kernel/readonly-does-not-exist/config.json',
    });
    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('write_error');
  });

  it('uses default outputPath when none provided', async () => {
    const result = await applyConfigAnswers({ answers: MINIMAL_ANSWERS });
    if (isErr(result)) {
      if (result.error.type !== 'write_error') throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
      return;
    }
    expect(result.value.path).toContain('.config/jobhelp/config.json');
    const written = JSON.parse(readFileSync(result.value.path, 'utf8')) as unknown;
    expect(written).toMatchObject({ profile: { location: 'Austin, TX' } });
    rmSync(result.value.path, { force: true });
  });

  it('ranking block always has useLlmFitScore: false', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({ ranking: { useLlmFitScore: false } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
