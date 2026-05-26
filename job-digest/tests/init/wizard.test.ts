import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initConfig } from '../../core/init/wizard.js';
import { applyConfigAnswers } from '../../core/init/applyAnswers.js';
import { loadConfig } from '../../core/lib/config.js';
import { isErr, isOk } from '../../core/types/result.js';

describe('initConfig', () => {
  describe('interactive mode', () => {
    it('returns ok with nextStep: ask_user', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result)}`);
      expect(result.value.nextStep).toBe('ask_user');
    });

    it('returns a non-empty prompts array', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      expect(result.value.prompts.length).toBeGreaterThan(0);
    });

    it('every prompt has key, question, and type', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      for (const p of result.value.prompts) {
        expect(typeof p.key).toBe('string');
        expect(p.key.length).toBeGreaterThan(0);
        expect(typeof p.question).toBe('string');
        expect(p.question.length).toBeGreaterThan(0);
        expect(['string', 'number', 'boolean', 'array']).toContain(p.type);
      }
    });

    it('includes required profile prompts', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const keys = result.value.prompts.map((p) => p.key);
      expect(keys).toContain('profile.location');
      expect(keys).toContain('profile.skills');
      expect(keys).toContain('profile.salaryFloor');
      expect(keys).toContain('profile.seniority');
      expect(keys).toContain('profile.roleFamily');
    });

    it('includes output.dir prompt with default', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const outputDir = result.value.prompts.find((p) => p.key === 'output.dir');
      expect(outputDir).toBeDefined();
      expect(outputDir?.default).toBe('~/jobhelp/digests');
    });

    it('includes rules.mode prompt with default additive', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const rulesMode = result.value.prompts.find((p) => p.key === 'rules.mode');
      expect(rulesMode).toBeDefined();
      expect(rulesMode?.default).toBe('additive');
    });

    it('includes rules.userRulesDir prompt with default', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const rulesDir = result.value.prompts.find((p) => p.key === 'rules.userRulesDir');
      expect(rulesDir).toBeDefined();
      expect(rulesDir?.default).toBe('~/jobhelp/rules');
    });

    it('adzuna prompts are marked optional', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const adzunaKeys = [
        'sources.adzuna.appId',
        'sources.adzuna.appKey',
        'sources.adzuna.country',
        'sources.adzuna.queries',
      ];
      for (const key of adzunaKeys) {
        const p = result.value.prompts.find((pr) => pr.key === key);
        expect(p).toBeDefined();
        expect(p?.optional).toBe(true);
      }
    });

    it('adzuna queries prompt has a schema-valid default', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p = result.value.prompts.find((pr) => pr.key === 'sources.adzuna.queries');
      expect(p?.type).toBe('array');
      expect(p?.default).toEqual(['software engineer']);
    });

    it('greenhouse and lever prompts are marked optional', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p1 = result.value.prompts.find((p) => p.key === 'sources.greenhouse.tokens');
      const p2 = result.value.prompts.find((p) => p.key === 'sources.lever.slugs');
      expect(p1?.optional).toBe(true);
      expect(p2?.optional).toBe(true);
    });

    it('does NOT include any anthropic prompt', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const anthropicPrompts = result.value.prompts.filter((p) => p.key.startsWith('anthropic'));
      expect(anthropicPrompts).toHaveLength(0);
    });

    it('profile.skills type is array', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p = result.value.prompts.find((pr) => pr.key === 'profile.skills');
      expect(p?.type).toBe('array');
    });

    it('profile.salaryFloor type is number', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p = result.value.prompts.find((pr) => pr.key === 'profile.salaryFloor');
      expect(p?.type).toBe('number');
    });

    it('includes profile.resumeDumpPath prompt (string, required)', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p = result.value.prompts.find((pr) => pr.key === 'profile.resumeDumpPath');
      expect(p).toBeDefined();
      expect(p?.type).toBe('string');
      expect(p?.optional).toBeFalsy();
    });

    it('includes profile.remoteOk prompt (boolean, required)', () => {
      const result = initConfig({ interactive: true });
      if (!isOk(result)) throw new Error('expected ok');
      const p = result.value.prompts.find((pr) => pr.key === 'profile.remoteOk');
      expect(p).toBeDefined();
      expect(p?.type).toBe('boolean');
      expect(p?.optional).toBeFalsy();
    });
  });

  describe('non-interactive mode', () => {
    it('returns err with validation type', () => {
      const result = initConfig({ interactive: false });
      if (!isErr(result)) throw new Error(`expected err; got ${JSON.stringify(result)}`);
      expect(result.error.type).toBe('validation');
    });

    it('error message mentions interactive', () => {
      const result = initConfig({ interactive: false });
      if (!isErr(result)) throw new Error('expected err');
      expect(result.error.message).toMatch(/interactive/);
    });

    it('refuses to apply when interactive=false (does not silently write incomplete config)', () => {
      const result = initConfig({ interactive: false });
      if (!isErr(result)) throw new Error('expected err');
      expect(result.error.message).toMatch(/interactive: true/);
    });
  });

  describe('default (interactive not specified)', () => {
    it('defaults to interactive=true behavior', () => {
      const result = initConfig({});
      if (!isOk(result)) throw new Error('expected ok');
      expect(result.value.nextStep).toBe('ask_user');
    });
  });
});

describe('wizard → applyConfigAnswers → loadConfig round-trip', () => {
  it('config written with all wizard answers passes loadConfig validation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhelp-wizard-rt-'));
    try {
      const configPath = join(dir, 'config.json');
      const answers: Record<string, unknown> = {
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
      const applyResult = await applyConfigAnswers({ answers, outputPath: configPath });
      if (!isOk(applyResult)) throw new Error(`applyConfigAnswers failed: ${JSON.stringify(applyResult)}`);
      const loadResult = await loadConfig(configPath);
      if (!isOk(loadResult)) throw new Error(`loadConfig failed: ${JSON.stringify(loadResult)}`);
      expect(loadResult.value.profile.resumeDumpPath).toContain('Documents/resume.md');
      expect(loadResult.value.profile.remoteOk).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
