import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../core/lib/config-validation.js';

function rawConfig(rankingOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: ['ts'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: ['backend'],
    },
    ranking: { topN: 1, digestK: 1, ...rankingOverrides },
    output: { dir: '/tmp' },
  };
}

describe('recall funnel config', () => {
  it('injects persistK/triage/semantic defaults when absent', () => {
    const cfg = validateConfig(rawConfig());
    expect(cfg.ranking.persistK).toBe(1000);
    expect(cfg.ranking.triage).toEqual({ model: 'sonnet', chunkSize: 150, triageK: 1000 });
    expect(cfg.ranking.semantic).toEqual({ enabled: false });
  });

  it('injects the same defaults when ranking block is entirely absent', () => {
    const raw = rawConfig();
    delete raw['ranking'];
    const cfg = validateConfig(raw);
    expect(cfg.ranking.persistK).toBe(1000);
    expect(cfg.ranking.triage).toEqual({ model: 'sonnet', chunkSize: 150, triageK: 1000 });
    expect(cfg.ranking.semantic).toEqual({ enabled: false });
  });

  it('respects explicit values', () => {
    const cfg = validateConfig(
      rawConfig({
        persistK: 200,
        triage: { model: 'opus', chunkSize: 100, triageK: 400 },
        semantic: { enabled: true, model: 'custom/model' },
      }),
    );
    expect(cfg.ranking.persistK).toBe(200);
    expect(cfg.ranking.triage).toEqual({ model: 'opus', chunkSize: 100, triageK: 400 });
    expect(cfg.ranking.semantic).toEqual({ enabled: true, model: 'custom/model' });
  });

  it('fills partial triage/semantic blocks with per-field defaults', () => {
    const cfg = validateConfig(
      rawConfig({ triage: { model: 'opus' }, semantic: { enabled: true } }),
    );
    expect(cfg.ranking.triage).toEqual({ model: 'opus', chunkSize: 150, triageK: 1000 });
    expect(cfg.ranking.semantic).toEqual({ enabled: true });
  });

  it('rejects non-numeric persistK and non-string triage.model', () => {
    expect(() => validateConfig(rawConfig({ persistK: 'lots' }))).toThrow(/persistK/);
    expect(() => validateConfig(rawConfig({ triage: { model: 7 } }))).toThrow(/triage\.model/);
    expect(() => validateConfig(rawConfig({ semantic: { enabled: 'yes' } }))).toThrow(
      /semantic\.enabled/,
    );
  });

  it('falls back to defaults for non-positive numerics', () => {
    const cfg = validateConfig(
      rawConfig({ persistK: 0, triage: { chunkSize: -3, triageK: 0 } }),
    );
    expect(cfg.ranking.persistK).toBe(1000);
    expect(cfg.ranking.triage).toEqual({ model: 'sonnet', chunkSize: 150, triageK: 1000 });
  });
});
