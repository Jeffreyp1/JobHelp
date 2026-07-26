import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProfileCard,
  buildTriageLine,
  bundleTriage,
} from '../../core/applications/triage.js';
import { persistDigest } from '../../core/state/digestStore.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import type { PersistedDigest } from '../../core/state/index.js';
import type { RankedJob } from '../../core/types/index.js';

let sandbox: string;
let prevHome: string | undefined;

function makeRanked(rank: number, overrides: Partial<RankedJob['job']> = {}): RankedJob {
  return {
    rank,
    score: 0.123456,
    job: {
      id: `src:job-${rank}`,
      source: 'adzuna',
      url: `https://example.com/${rank}`,
      title: `Backend Engineer ${rank}`,
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote',
      description: 'We use TypeScript and Node daily.',
      postedAt: '2026-05-13T00:00:00.000Z',
      ...overrides,
    },
    breakdown: { keywordOverlap: 0.5, recencyBoost: 1, bm25f: 0.5 },
  };
}

function makeConfig(rankingOverrides: Record<string, unknown> = {}) {
  return validateConfig({
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: ['typescript', 'node', 'go'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 90000,
      seniority: 'entry',
      roleFamily: ['backend'],
      allowedCountries: ['US'],
    },
    ranking: { topN: 1, digestK: 1, ...rankingOverrides },
    output: { dir: '/tmp' },
  });
}

async function persistJobs(jobs: RankedJob[]): Promise<void> {
  const digest: PersistedDigest = {
    date: '2026-05-15',
    generatedAt: '2026-05-15T13:00:00.000Z',
    totalDurationMs: 1,
    sourceResults: [{ source: 'adzuna', jobCount: jobs.length, durationMs: 1 }],
    jobs,
  };
  const r = await persistDigest(digest);
  if (!r.ok) throw new Error(`fixture persist failed: ${r.error.message}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-triage-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('buildTriageLine', () => {
  it('renders the frozen line format', () => {
    const line = buildTriageLine(makeRanked(7), ['typescript', 'node', 'go']);
    expect(line).toBe(
      '7. src:job-7 | Backend Engineer 7 @ Acme | Remote (US) | remote | 2026-05-13T00:00:00.000Z | skills:typescript,node | s=0.1235',
    );
  });

  it('uses word boundaries: go does not match google', () => {
    const r = makeRanked(1, { description: 'We love Google Cloud.' });
    const line = buildTriageLine(r, ['go']);
    expect(line).toContain('skills:-');
  });

  it('caps matched skills at 6', () => {
    const skills = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'];
    const r = makeRanked(1, { description: 'a1 b2 c3 d4 e5 f6 g7' });
    const line = buildTriageLine(r, skills);
    expect(line).toContain('skills:a1,b2,c3,d4,e5,f6 ');
  });

  it('renders undated when postedAt is missing', () => {
    const job = makeRanked(1);
    const noDate: RankedJob = {
      ...job,
      job: (({ postedAt: _postedAt, ...rest }) => rest)(job.job),
    };
    expect(buildTriageLine(noDate, [])).toContain('| undated |');
  });

  it('appends an APPLIED tag when the job id is in the applied set', () => {
    const line = buildTriageLine(makeRanked(1), ['typescript'], new Set(['src:job-1']));
    expect(line.endsWith('| APPLIED')).toBe(true);
  });

  it('omits the APPLIED tag when the job id is not applied', () => {
    const line = buildTriageLine(makeRanked(1), ['typescript'], new Set(['other:id']));
    expect(line).not.toContain('APPLIED');
  });

  it('leaves the frozen format untouched when no applied set is given', () => {
    const line = buildTriageLine(makeRanked(7), ['typescript', 'node', 'go']);
    expect(line).not.toContain('APPLIED');
  });
});

describe('buildProfileCard', () => {
  it('includes the constraint fields a triage judge needs', () => {
    const card = buildProfileCard(makeConfig().profile);
    expect(card).toContain('typescript');
    expect(card).toContain('entry');
    expect(card).toContain('backend');
    expect(card).toContain('90000');
    expect(card).toContain('remoteOk: true');
    expect(card).toContain('US');
  });
});

describe('bundleTriage', () => {
  it('returns lines for every persisted job with triage config attached', async () => {
    await persistJobs([makeRanked(1), makeRanked(2), makeRanked(3)]);
    const r = await bundleTriage(makeConfig());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.total).toBe(3);
    expect(r.value.returned).toBe(3);
    expect(r.value.truncated).toBe(false);
    expect(r.value.lines).toHaveLength(3);
    expect(r.value.triage).toEqual({ model: 'sonnet', chunkSize: 150 });
    expect(r.value.profileCard).toContain('typescript');
  });

  it('clamps to triageK and flags truncation', async () => {
    await persistJobs([makeRanked(1), makeRanked(2), makeRanked(3)]);
    const r = await bundleTriage(makeConfig(), { triageK: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.returned).toBe(2);
    expect(r.value.truncated).toBe(true);
    expect(r.value.lines[1]).toContain('src:job-2');
  });

  it('config triageK is a hard ceiling on caller requests', async () => {
    await persistJobs([makeRanked(1), makeRanked(2), makeRanked(3)]);
    const r = await bundleTriage(makeConfig({ triage: { triageK: 2 } }), { triageK: 999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.returned).toBe(2);
    expect(r.value.truncated).toBe(true);
  });

  it('sanitizes pipes and newlines in source-controlled fields', () => {
    const r = makeRanked(1, { title: 'Senior | Staff\nEngineer', company: 'Acme|Corp' });
    const line = buildTriageLine(r, []);
    expect(line).toContain('Senior Staff Engineer @ Acme Corp');
    expect(line.split('|')).toHaveLength(7);
    expect(line).not.toContain('\n');
  });

  it('errors with no_digest when nothing is persisted', async () => {
    const r = await bundleTriage(makeConfig());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.type).toBe('no_digest');
  });

  it('tags only the applied jobs when given an appliedJobIds set', async () => {
    await persistJobs([makeRanked(1), makeRanked(2)]);
    const r = await bundleTriage(makeConfig(), { appliedJobIds: new Set(['src:job-1']) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines[0]).toContain('| APPLIED');
    expect(r.value.lines[1]).not.toContain('APPLIED');
  });
});
