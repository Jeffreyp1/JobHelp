import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleRerank } from '../../core/applications/rerank.js';
import { persistDigest } from '../../core/state/digestStore.js';
import type { Registry } from '../../core/resumes/registry.js';
import type { PersistedDigest } from '../../core/state/index.js';
import type { RankedJob } from '../../core/types/index.js';
import { ok, err } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

const fakeRegistry: Registry = {
  registerResume: async () => err({ type: 'io', message: 'unused' }),
  setActiveResume: async () => err({ type: 'io', message: 'unused' }),
  readResume: async () => ok('# Resume\nTypeScript.'),
  listResumes: async () => ok([]),
};

function makeRanked(rank: number): RankedJob {
  return {
    rank,
    score: 1 / rank,
    job: {
      id: `src:job-${rank}`,
      source: 'adzuna',
      url: `https://example.com/${rank}`,
      title: `Engineer ${rank}`,
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote',
      description: `JD number ${rank}.`,
      postedAt: '2026-05-13T00:00:00.000Z',
    },
    breakdown: { keywordOverlap: 0.5, recencyBoost: 1, bm25f: 0.5 },
  };
}

async function persistJobs(count: number): Promise<void> {
  const digest: PersistedDigest = {
    date: '2026-05-15',
    generatedAt: '2026-05-15T13:00:00.000Z',
    totalDurationMs: 1,
    sourceResults: [{ source: 'adzuna', jobCount: count, durationMs: 1 }],
    jobs: Array.from({ length: count }, (_, i) => makeRanked(i + 1)),
  };
  const r = await persistDigest(digest);
  if (!r.ok) throw new Error(`fixture persist failed: ${r.error.message}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-rerank-ids-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('bundleRerank jobIds selection', () => {
  it('bundles exactly the requested ids in digest rank order, deduped', async () => {
    await persistJobs(60);
    const r = await bundleRerank(fakeRegistry, 'main', {
      jobIds: ['src:job-55', 'src:job-3', 'src:job-55', 'src:job-9'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs.map((j) => j.job.id)).toEqual([
      'src:job-3',
      'src:job-9',
      'src:job-55',
    ]);
    expect(r.value.summary.topK).toBe(3);
    expect(r.value.summary.missingIds).toEqual([]);
  });

  it('reports unknown ids in missingIds without failing', async () => {
    await persistJobs(5);
    const r = await bundleRerank(fakeRegistry, 'main', {
      jobIds: ['src:job-2', 'src:nope', 'src:job-4'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs.map((j) => j.job.id)).toEqual(['src:job-2', 'src:job-4']);
    expect(r.value.summary.missingIds).toEqual(['src:nope']);
  });

  it('errors when none of the ids exist', async () => {
    await persistJobs(2);
    const r = await bundleRerank(fakeRegistry, 'main', { jobIds: ['a', 'b'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('none of the requested jobIds');
  });

  it('caps selection at 100 ids', async () => {
    await persistJobs(150);
    const ids = Array.from({ length: 120 }, (_, i) => `src:job-${i + 1}`);
    const r = await bundleRerank(fakeRegistry, 'main', { jobIds: ids });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs).toHaveLength(100);
  });

  it('keeps legacy topK behavior byte-identical when jobIds is absent', async () => {
    await persistJobs(60);
    const r = await bundleRerank(fakeRegistry, 'main', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs).toHaveLength(30);
    expect(r.value.jobs[0]?.job.id).toBe('src:job-1');
    expect(r.value.summary.missingIds).toBeUndefined();
  });
});
