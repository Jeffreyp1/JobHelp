import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig } from '../../core/lib/config.js';
import { isErr, isOk } from '../../core/types/result.js';

const BASE_PROFILE = {
  resumeDumpPath: '/tmp/r.md',
  skills: ['ts'],
  location: 'X',
  remoteOk: true,
  salaryFloor: 1,
  seniority: 'entry',
  roleFamily: ['backend'],
};

function writeTempConfig(extraSources: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobhelp-cfg-roundtrip-'));
  const p = join(dir, 'config.json');
  writeFileSync(
    p,
    JSON.stringify({
      profile: BASE_PROFILE,
      ranking: { topN: 1, digestK: 1 },
      output: { dir: '/tmp' },
      sources: extraSources,
    }),
  );
  return p;
}

describe('loadConfig — round-trip for newly-added source adapters', () => {
  it('preserves sources.workable.tokens', async () => {
    const p = writeTempConfig({ workable: { tokens: ['polestar', 'talkdesk'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.workable).toBeDefined();
      expect(result.value.sources.workable?.tokens).toEqual(['polestar', 'talkdesk']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.smartrecruiters.tokens', async () => {
    const p = writeTempConfig({ smartrecruiters: { tokens: ['visa', 'square'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.smartrecruiters?.tokens).toEqual(['visa', 'square']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.ashby.tokens', async () => {
    const p = writeTempConfig({ ashby: { tokens: ['ramp', 'notion'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.ashby?.tokens).toEqual(['ramp', 'notion']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.recruitee.tokens', async () => {
    const p = writeTempConfig({ recruitee: { tokens: ['bunq'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.recruitee?.tokens).toEqual(['bunq']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.teamtailor.tokens', async () => {
    const p = writeTempConfig({ teamtailor: { tokens: ['polestar', 'klarna'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.teamtailor?.tokens).toEqual(['polestar', 'klarna']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.breezy.tokens', async () => {
    const p = writeTempConfig({ breezy: { tokens: ['acmehr'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.breezy?.tokens).toEqual(['acmehr']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.pinpoint.tokens', async () => {
    const p = writeTempConfig({ pinpoint: { tokens: ['workwithus'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.pinpoint?.tokens).toEqual(['workwithus']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.personio.tokens', async () => {
    const p = writeTempConfig({ personio: { tokens: ['traderepublic'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.personio?.tokens).toEqual(['traderepublic']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves sources.remoteok as empty object', async () => {
    const p = writeTempConfig({ remoteok: {} });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.remoteok).toBeDefined();
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('loads editable company-sources.json next to config.json, unioned with the bundled lists', async () => {
    const p = writeTempConfig({});
    const dir = dirname(p);
    try {
      writeFileSync(
        join(dir, 'company-sources.json'),
        JSON.stringify({
          greenhouse: { tokens: ['user-kept-greenhouse'] },
          lever: { slugs: ['user-kept-lever'] },
        }),
      );
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.greenhouse?.tokens).toContain('user-kept-greenhouse');
      expect(result.value.sources.lever?.slugs).toContain('user-kept-lever');
      expect(result.value.sources.greenhouse?.tokens.length).toBeGreaterThan(1000);
      expect(result.value.sources.lever?.slugs.length).toBeGreaterThan(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves sources.remotive.queries', async () => {
    const p = writeTempConfig({ remotive: { queries: ['python', 'go'] } });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.remotive?.queries).toEqual(['python', 'go']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('preserves a config that combines multiple newly-added sources', async () => {
    const p = writeTempConfig({
      workable: { tokens: ['polestar'] },
      smartrecruiters: { tokens: ['visa'] },
      teamtailor: { tokens: ['klarna'] },
    });
    try {
      const result = await loadConfig(p);
      if (!isOk(result)) throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
      expect(result.value.sources.workable?.tokens).toEqual(['polestar']);
      expect(result.value.sources.smartrecruiters?.tokens).toEqual(['visa']);
      expect(result.value.sources.teamtailor?.tokens).toEqual(['klarna']);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('rejects sources.workable.tokens with wrong type', async () => {
    const p = writeTempConfig({ workable: { tokens: 'not-an-array' } });
    try {
      const result = await loadConfig(p);
      if (!isErr(result)) throw new Error('expected err');
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toContain('workable');
    } finally {
      rmSync(p, { force: true });
    }
  });
});
