import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { appendRunMetrics, buildRunMetrics } from '../../core/digest/metrics.js';
import type { NormalizedJob, RankedJob, ScoreBreakdown } from '../../core/types/index.js';

function makeJob(id: string): NormalizedJob {
  return {
    id,
    source: 'alpha',
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    company: `Company ${id}`,
    location: 'Remote',
    remote: 'remote',
    description: 'Description.',
  };
}

function ranked(id: string, rank: number, breakdown: ScoreBreakdown): RankedJob {
  return { job: makeJob(id), rank, score: 1 / rank, breakdown };
}

const BASE = {
  date: '2026-07-19',
  generatedAt: '2026-07-19T12:00:00.000Z',
  totalDurationMs: 1234,
  poolKept: 100,
  filterDrops: { ghost: 5, age: 2 },
  sourceResults: [
    { source: 'alpha', jobCount: 80, durationMs: 10 },
    { source: 'beta', jobCount: 20, durationMs: 5, error: { type: 'network' as const, message: 'boom' } },
  ],
  rankedCount: 90,
};

describe('buildRunMetrics', () => {
  it('captures counts, drops, and per-source outcomes', () => {
    const m = buildRunMetrics({ ...BASE, topK: [] });
    expect(m.date).toBe('2026-07-19');
    expect(m.poolKept).toBe(100);
    expect(m.filterDrops).toEqual({ ghost: 5, age: 2 });
    expect(m.rankedCount).toBe(90);
    expect(m.digestCount).toBe(0);
    expect(m.sources).toEqual([
      { source: 'alpha', jobCount: 80 },
      { source: 'beta', jobCount: 20, errorType: 'network' },
    ]);
  });

  it('summarizes semantic scores and history boosts over the digest slice', () => {
    const topK = [
      ranked('a', 1, { keywordOverlap: 1, recencyBoost: 1, bm25f: 1, semantic: 0.8, historyBoost: 1.15 }),
      ranked('b', 2, { keywordOverlap: 1, recencyBoost: 1, bm25f: 1, semantic: 0.6 }),
      ranked('c', 3, { keywordOverlap: 1, recencyBoost: 1, bm25f: 1, semantic: 0.7, historyBoost: 1.02 }),
    ];
    const m = buildRunMetrics({ ...BASE, topK });
    expect(m.digestCount).toBe(3);
    expect(m.semantic).toEqual({ min: 0.6, median: 0.7, max: 0.8 });
    expect(m.historyBoosted).toBe(2);
  });

  it('omits semantic stats when no digest job has a semantic score', () => {
    const topK = [ranked('a', 1, { keywordOverlap: 1, recencyBoost: 1, bm25f: 1 })];
    const m = buildRunMetrics({ ...BASE, topK });
    expect(m.semantic).toBeUndefined();
    expect(m.historyBoosted).toBe(0);
  });

  it('includes appliedInDigest only when provided', () => {
    expect(buildRunMetrics({ ...BASE, topK: [] }).appliedInDigest).toBeUndefined();
    expect(buildRunMetrics({ ...BASE, topK: [], appliedInDigest: 4 }).appliedInDigest).toBe(4);
  });
});

describe('appendRunMetrics', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jobhelp-metrics-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('appends one JSON line per run', async () => {
    const file = path.join(tmpDir, 'metrics.jsonl');
    const m1 = buildRunMetrics({ ...BASE, topK: [] });
    const m2 = buildRunMetrics({ ...BASE, date: '2026-07-20', topK: [] });
    await appendRunMetrics(file, m1);
    await appendRunMetrics(file, m2);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '').date).toBe('2026-07-19');
    expect(JSON.parse(lines[1] ?? '').date).toBe('2026-07-20');
  });

  it('creates missing parent directories', async () => {
    const file = path.join(tmpDir, 'nested', 'deep', 'metrics.jsonl');
    await appendRunMetrics(file, buildRunMetrics({ ...BASE, topK: [] }));
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});
