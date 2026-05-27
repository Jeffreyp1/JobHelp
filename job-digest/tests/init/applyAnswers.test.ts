import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyConfigAnswers } from '../../core/init/applyAnswers.js';
import { loadConfig } from '../../core/lib/config.js';
import { isOk, isErr } from '../../core/types/result.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'jobhelp-apply-test-'));
}

const MINIMAL_ANSWERS: Record<string, unknown> = {
  'profile.location': 'Irvine, CA',
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

  it('creates editable company-sources.json next to the config with verified company boards', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const result = await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.companySourcesPath).toBe(join(dir, 'company-sources.json'));
      const written = JSON.parse(readFileSync(result.value.companySourcesPath, 'utf8')) as {
        greenhouse?: { tokens?: string[] };
        ashby?: { tokens?: string[] };
        lever?: { slugs?: string[] };
        workable?: { tokens?: string[] };
      };
      expect(written.greenhouse?.tokens?.length).toBeGreaterThan(1000);
      expect(written.ashby?.tokens?.length).toBeGreaterThan(1000);
      expect(written.workable?.tokens?.length).toBeGreaterThan(1000);
      expect(written.lever?.slugs?.length).toBeGreaterThan(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing company-sources.json that the user edited', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const companySourcesPath = join(dir, 'company-sources.json');
      writeFileSync(companySourcesPath, '{\n  "greenhouse": { "tokens": ["user-kept"] }\n}\n');
      const result = await applyConfigAnswers({ answers: MINIMAL_ANSWERS, outputPath: configPath });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(readFileSync(companySourcesPath, 'utf8')).toBe('{\n  "greenhouse": { "tokens": ["user-kept"] }\n}\n');
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
          location: 'Irvine, CA',
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
        'sources.adzuna.queries': ['entry software engineer'],
      };
      await applyConfigAnswers({ answers, outputPath: configPath });
      const written = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      expect(written).toMatchObject({
        sources: {
          adzuna: {
            appId: 'my-app-id',
            appKey: 'my-app-key',
            country: 'us',
            queries: ['entry software engineer'],
          },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives adzuna queries from role answers when credentials use wizard defaults', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const answers = {
        ...MINIMAL_ANSWERS,
        'sources.adzuna.appId': 'my-app-id',
        'sources.adzuna.appKey': 'my-app-key',
        'sources.adzuna.country': 'us',
      };
      const applied = await applyConfigAnswers({ answers, outputPath: configPath });
      if (!isOk(applied)) throw new Error(`expected ok; got ${JSON.stringify(applied.error)}`);
      const loaded = await loadConfig(configPath);
      if (!isOk(loaded)) throw new Error(`expected valid config; got ${JSON.stringify(loaded.error)}`);
      expect(loaded.value.sources.adzuna?.queries).toEqual(['backend']);
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
    expect(written).toMatchObject({ profile: { location: 'Irvine, CA' } });
    rmSync(result.value.path, { force: true });
  });

  it('with empty answers, the written config FAILS loadConfig validation', async () => {
    const dir = makeTmpDir();
    try {
      const configPath = join(dir, 'config.json');
      const result = await applyConfigAnswers({ answers: {}, outputPath: configPath });
      if (!isOk(result)) throw new Error(`expected write to succeed; got ${JSON.stringify(result.error)}`);
      const loaded = await loadConfig(configPath);
      if (!isErr(loaded)) {
        throw new Error('expected loadConfig to fail on empty-answers config — this contract guarantees the wizard cannot silently write an unusable config');
      }
      expect(loaded.error.type).toBe('validation');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
