import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools } from '../../mcp/src/tools.js';
import type { SourceCoverageGap } from '../../mcp/src/tools-meta-types.js';
import { getTool, makeDeps, parseResponseBody } from './_fixtures.js';

const KNOWN_KEYLESS = ['remoteok', 'remotive', 'weworkremotely', 'yc'] as const;
const KEYED = ['adzuna', 'jsearch', 'usajobs'] as const;

let tmp: string;
let prevHome: string | undefined;
let prevConfigPath: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'jobhelp-doctor-sources-'));
  prevHome = process.env['JOBHELP_HOME'];
  prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
  process.env['JOBHELP_HOME'] = tmp;
  process.env['JOBHELP_CONFIG_PATH'] = join(tmp, 'config.json');
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
  else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(sources: Record<string, unknown>): void {
  writeFileSync(
    join(tmp, 'config.json'),
    JSON.stringify({
      profile: {
        resumeDumpPath: join(tmp, 'resume.md'),
        skills: ['typescript'],
        location: 'Remote',
        remoteOk: true,
        salaryFloor: 100000,
        seniority: 'mid',
        roleFamily: ['backend'],
      },
      sources,
      ranking: { topN: 5, digestK: 5 },
      output: { dir: join(tmp, 'digests') },
      rules: { mode: 'additive', userRulesDir: join(tmp, 'rules') },
    }),
  );
}

async function doctorCoverage(): Promise<readonly SourceCoverageGap[]> {
  const { deps } = makeDeps();
  const tool = getTool(createTools(deps), 'doctor');
  const res = await tool.invoke({});
  expect(res.isError).toBeUndefined();
  const body = parseResponseBody(res.content) as {
    ok: true;
    value: { sourceCoverage?: readonly SourceCoverageGap[] };
  };
  expect(Array.isArray(body.value.sourceCoverage)).toBe(true);
  return body.value.sourceCoverage ?? [];
}

describe('doctor source coverage', () => {
  it('reports keyless adapters left disabled by a bare sources config', async () => {
    writeConfig({});
    const coverage = await doctorCoverage();
    for (const source of KNOWN_KEYLESS) {
      const gap = coverage.find((g) => g.source === source);
      expect(gap, source).toBeDefined();
      expect(gap?.kind).toBe('keyless-disabled');
      expect(gap?.hint.length).toBeGreaterThan(0);
    }
  });

  it('reports key-required adapters that are not configured, with per-source hints', async () => {
    writeConfig({});
    const coverage = await doctorCoverage();
    for (const source of KEYED) {
      const gap = coverage.find((g) => g.source === source);
      expect(gap, source).toBeDefined();
      expect(gap?.kind).toBe('key-missing');
      expect(gap?.hint.length).toBeGreaterThan(0);
    }
    expect(coverage.find((g) => g.source === 'adzuna')?.hint).toContain('developer.adzuna.com');
  });

  it('treats blank credentials as key-missing', async () => {
    writeConfig({
      adzuna: { appId: '', appKey: '', country: 'us', queries: ['backend'] },
    });
    const coverage = await doctorCoverage();
    expect(coverage.find((g) => g.source === 'adzuna')?.kind).toBe('key-missing');
  });

  it('does not flag enabled keyless or fully configured keyed sources', async () => {
    writeConfig({
      remoteok: {},
      remotive: {},
      weworkremotely: {},
      yc: {},
      adzuna: { appId: 'id', appKey: 'key', country: 'us', queries: ['backend'] },
      jsearch: { rapidApiKey: 'key' },
      usajobs: { apiKey: 'key', email: 'a@b.test' },
    });
    const coverage = await doctorCoverage();
    for (const source of [...KNOWN_KEYLESS, ...KEYED]) {
      expect(coverage.find((g) => g.source === source), source).toBeUndefined();
    }
  });

  it('flags configured company-list sources with zero tokens', async () => {
    writeConfig({
      greenhouse: { tokens: [] },
      lever: { slugs: [] },
      ashby: { tokens: ['ramp'] },
    });
    const coverage = await doctorCoverage();
    expect(coverage.find((g) => g.source === 'greenhouse')?.kind).toBe('empty-token-list');
    expect(coverage.find((g) => g.source === 'lever')?.kind).toBe('empty-token-list');
    expect(coverage.find((g) => g.source === 'ashby')).toBeUndefined();
    expect(coverage.find((g) => g.source === 'workable')).toBeUndefined();
  });

  it('returns empty coverage when the config cannot be loaded', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'doctor');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { ready: boolean; sourceCoverage?: readonly SourceCoverageGap[] };
    };
    expect(body.value.ready).toBe(false);
    expect(body.value.sourceCoverage).toEqual([]);
  });
});
