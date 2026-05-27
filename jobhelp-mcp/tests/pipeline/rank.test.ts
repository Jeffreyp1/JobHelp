import { describe, it, expect } from 'vitest';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

import { rank } from '../../core/pipeline/rank.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go', 'python', 'kubernetes'],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/digests' },
  };
  return { ...base, ...overrides };
}

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'adzuna:abc',
    source: 'adzuna',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: 'remote',
    description: 'Build software',
    ...overrides,
  };
}

describe('rank — keywordOverlap', () => {
  it('counts skills appearing as whole words in title+description', async () => {
    const job = makeJob({ id: 'a', title: 'TypeScript Engineer', description: 'You will write Go and Python code daily.' });
    const out = await rank([job], makeConfig());
    expect(out).toHaveLength(1);
    expect(out[0]?.breakdown.keywordOverlap).toBeCloseTo(0.75, 5);
  });
  it('clamps keywordOverlap to [0, 1]', async () => {
    const job = makeJob({ id: 'a', title: 'TypeScript Go Python Kubernetes', description: 'typescript go python kubernetes' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.keywordOverlap).toBe(1);
  });
  it('returns 0 when no skill matches', async () => {
    const job = makeJob({ title: 'Plumber', description: 'Fix pipes' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.keywordOverlap).toBe(0);
  });
  it('matches whole-words only (no substring match)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, skills: ['javascript'] } });
    const job = makeJob({ title: 'Eng', description: 'javascripted code is everywhere' });
    const out = await rank([job], cfg);
    expect(out[0]?.breakdown.keywordOverlap).toBe(0);
  });
});

describe('rank — recencyBoost', () => {
  it('returns 1.0 when postedAt is undefined', async () => {
    const job = makeJob({ id: 'a', title: 'TypeScript', description: 'go python' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.recencyBoost).toBe(1.0);
  });
  it('decays toward 0.5 as postings get older', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000).toISOString();
    const job = makeJob({ postedAt: tenDaysAgo, description: 'typescript' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.recencyBoost).toBeGreaterThan(0.5);
    expect(out[0]?.breakdown.recencyBoost).toBeLessThan(1.0);
  });
  it('floors at 0.5 for very old postings', async () => {
    const ancient = new Date('2020-01-01').toISOString();
    const job = makeJob({ postedAt: ancient, description: 'typescript' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.recencyBoost).toBe(0.5);
  });
  it('returns 1.0 when postedAt is unparseable', async () => {
    const job = makeJob({ postedAt: 'definitely not a date', description: 'typescript' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.recencyBoost).toBe(1.0);
  });
});

describe('rank — ranking and sort', () => {
  it('assigns 1-indexed rank in descending score order', async () => {
    const high = makeJob({ id: 'high', title: 'TypeScript Go Python', description: 'kubernetes' });
    const low = makeJob({ id: 'low', title: 'Eng', description: 'no matches' });
    const out = await rank([low, high], makeConfig());
    expect(out[0]?.job.id).toBe('high');
    expect(out[0]?.rank).toBe(1);
    expect(out[1]?.job.id).toBe('low');
    expect(out[1]?.rank).toBe(2);
  });
  it('llmFitScore is always undefined (Design B: no LLM calls)', async () => {
    const job = makeJob({ title: 'TypeScript' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.llmFitScore).toBeUndefined();
    expect(out[0]?.llmRationale).toBeUndefined();
  });
  it('handles an empty input', async () => {
    const out = await rank([], makeConfig());
    expect(out).toEqual([]);
  });
  it('score equals bm25f * recencyBoost', async () => {
    const job = makeJob({ id: 'a', title: 'TypeScript', description: 'go python' });
    const out = await rank([job], makeConfig());
    const bm25f = out[0]?.breakdown.bm25f ?? 0;
    const r = out[0]?.breakdown.recencyBoost ?? 0;
    expect(out[0]?.score).toBeCloseTo(bm25f * r, 5);
  });
});

describe('rank — BM25F-based ranking', () => {
  it('Backend Engineer @ Stripe outranks Operations Associate @ Stripe for backend-heavy resume', async () => {
    const backendCfg = makeConfig({
      profile: {
        ...makeConfig().profile,
        skills: ['typescript', 'go', 'python', 'kubernetes', 'kafka', 'postgresql'],
      },
    });
    const backend = makeJob({
      id: 'stripe-backend',
      title: 'Backend Engineer',
      company: 'Stripe',
      description: 'You will build distributed systems in Go and TypeScript, with Postgres and Kafka.',
    });
    const ops = makeJob({
      id: 'stripe-ops',
      title: 'Operations Associate',
      company: 'Stripe',
      description: 'Coordinate vendor onboarding and reconcile finance reports across teams.',
    });
    const out = await rank([ops, backend], backendCfg);
    expect(out[0]?.job.id).toBe('stripe-backend');
    expect(out[1]?.job.id).toBe('stripe-ops');
  });

  it('ScoreBreakdown contains bm25f field (number, >= 0)', async () => {
    const job = makeJob({ title: 'TypeScript', description: 'go python kubernetes' });
    const out = await rank([job], makeConfig());
    const b = out[0]?.breakdown.bm25f;
    expect(typeof b).toBe('number');
    expect(b ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('keywordOverlap is still computed alongside bm25f (back-compat)', async () => {
    const job = makeJob({ id: 'a', title: 'TypeScript Engineer', description: 'You will write Go and Python code daily.' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.keywordOverlap).toBeCloseTo(0.75, 5);
    expect(typeof out[0]?.breakdown.bm25f).toBe('number');
  });
});
