import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGetTriageList } from '../../mcp/src/wiring-handlers-triage.js';
import { persistDigest } from '../../core/state/digestStore.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import type { PersistedDigest } from '../../core/state/index.js';
import type { RankedJob } from '../../core/types/index.js';

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
});
