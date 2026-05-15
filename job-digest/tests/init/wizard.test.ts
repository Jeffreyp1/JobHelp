import { describe, it, expect } from 'vitest';
import { initConfig } from '../../core/init/wizard.js';
import { isOk } from '../../core/types/result.js';

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
      const adzunaKeys = ['sources.adzuna.appId', 'sources.adzuna.appKey', 'sources.adzuna.country'];
      for (const key of adzunaKeys) {
        const p = result.value.prompts.find((pr) => pr.key === key);
        expect(p).toBeDefined();
        expect(p?.optional).toBe(true);
      }
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
  });

  describe('non-interactive mode', () => {
    it('returns ok with nextStep: apply', () => {
      const result = initConfig({ interactive: false });
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result)}`);
      expect(result.value.nextStep).toBe('apply');
    });

    it('returns empty prompts array', () => {
      const result = initConfig({ interactive: false });
      if (!isOk(result)) throw new Error('expected ok');
      expect(result.value.prompts).toHaveLength(0);
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
