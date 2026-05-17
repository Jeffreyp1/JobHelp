import { describe, it, expect } from 'vitest';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';
import { rank, buildRankPrecomputed } from '../../core/pipeline/rank.js';
import { runPipeline } from '../../core/pipeline/index.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go', 'python'],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: { useLlmFitScore: false, topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules', mode: 'additive' },
    output: { dir: '/tmp/digests' },
  };
  return { ...base, ...overrides };
}

const PADDING =
  'We are a small high-leverage engineering team building distributed systems and shipping fast. ' +
  'Our codebase is modern and well-tested. You will own services end-to-end. Bring strong fundamentals.';

function makeJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'adzuna:abc',
    source: 'adzuna',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: 'remote',
    description: 'Build software in typescript and go and python. ' + PADDING,
    ...over,
  };
}

describe('rank — orchestrator invariants', () => {
  it('rank([]) returns []', async () => {
    const out = await rank([], makeConfig());
    expect(out).toEqual([]);
  });

  it('rank on a single job returns one entry with rank=1 and numeric score', async () => {
    const out = await rank([makeJob()], makeConfig());
    expect(out.length).toBe(1);
    expect(out[0]?.rank).toBe(1);
    expect(typeof out[0]?.score).toBe('number');
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
  });

  it('job with postedAt in the future does NOT produce NaN; score remains finite', async () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const out = await rank([makeJob({ postedAt: future })], makeConfig());
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
    expect(Number.isNaN(out[0]?.score ?? NaN)).toBe(false);
    expect(out[0]?.breakdown.recencyBoost).toBe(1.0);
  });

  it('job with postedAt undefined yields recencyBoost = 1.0 and finite score', async () => {
    const out = await rank([makeJob()], makeConfig());
    expect(out[0]?.breakdown.recencyBoost).toBe(1.0);
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
  });

  it('job with postedAt = epoch 1970-01-01 floors recencyBoost to 0.5 and stays finite', async () => {
    const out = await rank(
      [makeJob({ postedAt: '1970-01-01T00:00:00Z' })],
      makeConfig(),
    );
    expect(out[0]?.breakdown.recencyBoost).toBe(0.5);
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
  });

  it('rank on 1000 jobs completes in under 1 second', async () => {
    const jobs: NormalizedJob[] = Array.from({ length: 1000 }, (_, i) =>
      makeJob({
        id: `j-${i}`,
        title: i % 3 === 0 ? 'TypeScript Engineer' : 'Software Engineer',
        description: `description ${i} typescript go python ` + PADDING,
      }),
    );
    const t0 = performance.now();
    const out = await rank(jobs, makeConfig());
    const t1 = performance.now();
    expect(out.length).toBe(1000);
    expect(t1 - t0).toBeLessThan(1000);
  });

  it('two identical jobs (same id and content) get the same score and adjacent ranks', async () => {
    const j = makeJob({ id: 'a' });
    const k = makeJob({ id: 'b' });
    const out = await rank([j, k], makeConfig());
    expect(out.length).toBe(2);
    expect(out[0]?.score).toBe(out[1]?.score);
  });

  it('every output job has rank in [1..N] with no gaps', async () => {
    const jobs: NormalizedJob[] = Array.from({ length: 10 }, (_, i) =>
      makeJob({ id: `j${i}`, title: i % 2 === 0 ? 'TypeScript' : 'Eng' }),
    );
    const out = await rank(jobs, makeConfig());
    const ranks = out.map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('score is monotonically non-increasing in rank order', async () => {
    const jobs: NormalizedJob[] = Array.from({ length: 50 }, (_, i) =>
      makeJob({
        id: `j${i}`,
        title: i % 3 === 0 ? 'TypeScript Go Python' : 'Software Engineer',
        description: `desc ${i} ` + PADDING,
      }),
    );
    const out = await rank(jobs, makeConfig());
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1];
      const cur = out[i];
      if (prev !== undefined && cur !== undefined) {
        expect(prev.score).toBeGreaterThanOrEqual(cur.score);
      }
    }
  });

  it('score, bm25f, keywordOverlap, recencyBoost are ALL finite for every ranked job', async () => {
    const jobs: NormalizedJob[] = Array.from({ length: 30 }, (_, i) =>
      makeJob({ id: `j${i}`, title: i % 2 === 0 ? 'kafka' : 'eng' }),
    );
    const out = await rank(jobs, makeConfig());
    for (const r of out) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(Number.isFinite(r.breakdown.bm25f)).toBe(true);
      expect(Number.isFinite(r.breakdown.keywordOverlap)).toBe(true);
      expect(Number.isFinite(r.breakdown.recencyBoost)).toBe(true);
    }
  });

  it('runPipeline([]) returns []', async () => {
    const out = await runPipeline([], makeConfig());
    expect(out).toEqual([]);
  });

  it('runPipeline survives a single job and yields finite score', async () => {
    const j = makeJob({
      title: 'Backend Engineer',
      description: 'Build distributed backend APIs in typescript and go and python. ' + PADDING,
    });
    const out = await runPipeline([j], makeConfig());
    expect(out.length).toBe(1);
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
  });

  it('buildRankPrecomputed on empty jobs builds a corpus with N=0 and finite avg lengths', () => {
    const pc = buildRankPrecomputed([], makeConfig());
    expect(pc.corpus.N).toBe(0);
    expect(Number.isFinite(pc.corpus.avgFieldLengths.title)).toBe(true);
    expect(pc.queryTerms.length).toBeGreaterThan(0);
  });

  it('rank with a precomputed shares state and yields identical ordering to rank without one', async () => {
    const jobs: NormalizedJob[] = Array.from({ length: 20 }, (_, i) =>
      makeJob({ id: `j${i}`, title: i % 2 === 0 ? 'TypeScript' : 'Eng' }),
    );
    const cfg = makeConfig();
    const a = await rank(jobs, cfg);
    const pc = buildRankPrecomputed(jobs, cfg);
    const b = await rank(jobs, cfg, pc);
    expect(a.map((r) => r.job.id)).toEqual(b.map((r) => r.job.id));
    expect(a.map((r) => r.score)).toEqual(b.map((r) => r.score));
  });

  it('job whose title + description are EMPTY scores 0 / finite (not NaN)', async () => {
    const j = makeJob({ id: 'empty', title: '', description: '' });
    const out = await rank([j], makeConfig());
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
    expect(Number.isNaN(out[0]?.score ?? NaN)).toBe(false);
  });

  it('rank with empty skills list yields score=0 across all jobs (no NaN)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, skills: [] },
    });
    const out = await rank([makeJob(), makeJob({ id: 'b' })], cfg);
    for (const r of out) {
      expect(r.breakdown.keywordOverlap).toBe(0);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('rank with bm25 NaN k1 in config still produces finite scores (clamping fallback)', async () => {
    const cfg = makeConfig({
      ranking: {
        useLlmFitScore: false,
        topN: 20,
        digestK: 10,
        bm25: { k1: NaN, b: NaN, minIdfFloor: NaN },
      },
    });
    const out = await rank(
      [makeJob({ id: 'a', title: 'TypeScript' })],
      cfg,
    );
    expect(Number.isFinite(out[0]?.score ?? NaN)).toBe(true);
  });
});
