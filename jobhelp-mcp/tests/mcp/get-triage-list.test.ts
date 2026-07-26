import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGetTriageList } from '../../mcp/src/wiring-handlers-triage.js';
import { persistDigest } from '../../core/state/digestStore.js';
import { writeState } from '../../core/state/store.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import { EMPTY_STATE, type ApplicationEntry, type PersistedDigest } from '../../core/state/index.js';
import type { JobDigestConfig, RankedJob } from '../../core/types/index.js';

let sandbox: string;
let prevHome: string | undefined;

function makeRanked(rank: number): RankedJob {
  return {
    rank,
    score: 1 / rank,
    job: {
      id: `src:job-${rank}`,
      source: 'adzuna',
      url: `https://example.com/${rank}`,
      title: `Backend Engineer ${rank}`,
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote',
      description: 'TypeScript all day.',
      postedAt: '2026-05-13T00:00:00.000Z',
    },
    breakdown: { keywordOverlap: 0.5, recencyBoost: 1, bm25f: 0.5 },
  };
}

const CONFIG = validateConfig({
  profile: {
    resumeDumpPath: '/tmp/r.md',
    skills: ['typescript'],
    location: 'Remote',
    remoteOk: true,
    salaryFloor: 1,
    seniority: 'entry',
    roleFamily: ['backend'],
  },
  ranking: { topN: 1, digestK: 1 },
  output: { dir: '/tmp' },
});

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-triage-tool-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('handleGetTriageList', () => {
  it('returns the bundle plus a funnel directive', async () => {
    const digest: PersistedDigest = {
      date: '2026-05-15',
      generatedAt: '2026-05-15T13:00:00.000Z',
      totalDurationMs: 1,
      sourceResults: [{ source: 'adzuna', jobCount: 2, durationMs: 1 }],
      jobs: [makeRanked(1), makeRanked(2)],
    };
    const persisted = await persistDigest(digest);
    expect(persisted.ok).toBe(true);

    const r = await handleGetTriageList(CONFIG, { triageK: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.total).toBe(2);
    expect(r.value.returned).toBe(1);
    expect(r.value.truncated).toBe(true);
    expect(r.value.triage.model).toBe('sonnet');
    expect(r.value.lines[0]).toContain('src:job-1');
    expect(r.value.nextRequiredStep).toContain('rerank_top_jobs');
  });

  it('maps a missing digest to not_found', async () => {
    const r = await handleGetTriageList(CONFIG, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.type).toBe('not_found');
  });

  async function persistTwoAndSeedApplied(): Promise<void> {
    const applied = makeRanked(1);
    const other = makeRanked(2);
    const digest: PersistedDigest = {
      date: '2026-05-15',
      generatedAt: '2026-05-15T13:00:00.000Z',
      totalDurationMs: 1,
      sourceResults: [{ source: 'adzuna', jobCount: 2, durationMs: 1 }],
      jobs: [
        { ...applied, job: { ...applied.job, title: 'Backend Platform Engineer' } },
        { ...other, job: { ...other.job, title: 'Frontend Product Designer' } },
      ],
    };
    const persisted = await persistDigest(digest);
    if (!persisted.ok) throw new Error(persisted.error.message);
    const app: ApplicationEntry = {
      jobId: 'greenhouse:other',
      company: 'acme',
      role: 'Platform Backend Engineer',
      date: '2026-05-10',
      dir: '/tmp/apps/acme',
      url: 'https://other.test/xyz',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    };
    const w = await writeState({ ...EMPTY_STATE, applications: [app] });
    if (!w.ok) throw new Error(w.error.message);
  }

  function withHistory(enabled: boolean): JobDigestConfig {
    return validateConfig({
      profile: {
        resumeDumpPath: '/tmp/r.md',
        skills: ['typescript'],
        location: 'Remote',
        remoteOk: true,
        salaryFloor: 1,
        seniority: 'entry',
        roleFamily: ['backend'],
      },
      ranking: { topN: 2, digestK: 2, history: { enabled } },
      output: { dir: '/tmp' },
    });
  }

  it('tags an already-applied job with APPLIED when history is enabled', async () => {
    await persistTwoAndSeedApplied();
    const r = await handleGetTriageList(withHistory(true), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const applied = r.value.lines.find((l) => l.includes('src:job-1'));
    const other = r.value.lines.find((l) => l.includes('src:job-2'));
    expect(applied?.endsWith('| APPLIED')).toBe(true);
    expect(other).not.toContain('APPLIED');
  });

  it('does NOT tag applied jobs when history is disabled', async () => {
    await persistTwoAndSeedApplied();
    const r = await handleGetTriageList(withHistory(false), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines.some((l) => l.includes('APPLIED'))).toBe(false);
  });
});
