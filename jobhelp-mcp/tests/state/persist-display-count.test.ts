import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLatestDigest, persistDigest } from '../../core/state/digestStore.js';
import { handleGetLatestDigest } from '../../mcp/src/wiring-handlers-job.js';
import type { PersistedDigest } from '../../core/state/index.js';
import type { RankedJob } from '../../core/types/index.js';
import { isOk } from '../../core/types/result.js';

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
      title: `Unique Title ${rank}`,
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote',
      description: 'Build things.',
      postedAt: '2026-05-13T00:00:00.000Z',
    },
    breakdown: { keywordOverlap: 0.5, recencyBoost: 1, bm25f: 0.5 },
  };
}

const DIGEST: PersistedDigest = {
  date: '2026-05-15',
  generatedAt: '2026-05-15T13:00:00.000Z',
  totalDurationMs: 1,
  sourceResults: [{ source: 'adzuna', jobCount: 3, durationMs: 1 }],
  jobs: [makeRanked(1), makeRanked(2), makeRanked(3)],
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-displayk-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('persistDigest displayCount', () => {
  it('persists all jobs to JSON but only displayCount rows to markdown/csv', async () => {
    const result = await persistDigest(DIGEST, { displayCount: 1 });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const json = JSON.parse(readFileSync(result.value.path, 'utf8')) as PersistedDigest;
    expect(json.jobs).toHaveLength(3);
    expect(json.displayK).toBe(1);

    const md = readFileSync(result.value.markdownPath, 'utf8');
    expect(md).toContain('Unique Title 1');
    expect(md).not.toContain('Unique Title 2');

    const csv = readFileSync(result.value.csvPath, 'utf8');
    expect(csv).toContain('Unique Title 1');
    expect(csv).not.toContain('Unique Title 3');
  });

  it('omitting displayCount keeps full jobs in markdown (legacy behavior)', async () => {
    const result = await persistDigest(DIGEST);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const md = readFileSync(result.value.markdownPath, 'utf8');
    expect(md).toContain('Unique Title 3');
    const json = JSON.parse(readFileSync(result.value.path, 'utf8')) as PersistedDigest;
    expect(json.displayK).toBeUndefined();
  });

  it('getLatestDigest still returns the full persisted job list', async () => {
    await persistDigest(DIGEST, { displayCount: 1 });
    const latest = await getLatestDigest();
    expect(isOk(latest)).toBe(true);
    if (!isOk(latest)) return;
    expect(latest.value.jobs).toHaveLength(3);
    expect(latest.value.displayK).toBe(1);
  });

  it('handleGetLatestDigest returns only displayK jobs plus totalPersisted', async () => {
    await persistDigest(DIGEST, { displayCount: 1 });
    const r = await handleGetLatestDigest();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs).toHaveLength(1);
    expect(r.value.totalPersisted).toBe(3);
  });

  it('handleGetLatestDigest returns all jobs for legacy digests without displayK', async () => {
    await persistDigest(DIGEST);
    const r = await handleGetLatestDigest();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.jobs).toHaveLength(3);
    expect(r.value.totalPersisted).toBe(3);
  });
});
