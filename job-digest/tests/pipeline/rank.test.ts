import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

vi.mock('../../core/lib/claude.js', () => {
  return { callClaude: vi.fn() };
});

import { callClaude } from '../../core/lib/claude.js';
import { rank } from '../../core/pipeline/rank.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go', 'python', 'kubernetes'],
      location: 'Irvine, CA',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: { useLlmFitScore: false, llmModel: 'claude-haiku-4-5', topN: 20, digestK: 10 },
    output: { dir: '/tmp/digests' },
    anthropic: { apiKey: 'sk-ant-test' },
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
    location: 'Irvine, CA',
    remote: 'remote',
    description: 'Build software',
    ...overrides,
  };
}

beforeEach(() => { vi.mocked(callClaude).mockReset(); });
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
  it('keeps llmFitScore undefined when ranking.useLlmFitScore is false', async () => {
    const job = makeJob({ title: 'TypeScript' });
    const out = await rank([job], makeConfig());
    expect(out[0]?.breakdown.llmFitScore).toBeUndefined();
    expect(out[0]?.llmRationale).toBeUndefined();
    expect(vi.mocked(callClaude)).not.toHaveBeenCalled();
  });
  it('handles an empty input', async () => {
    const out = await rank([], makeConfig());
    expect(out).toEqual([]);
  });
});
describe('rank — LLM fit-score', () => {
  it('calls Claude for top-N when useLlmFitScore is true', async () => {
    const cfg = makeConfig({ ranking: { useLlmFitScore: true, llmModel: 'claude-haiku-4-5', topN: 2, digestK: 10 } });
    vi.mocked(callClaude).mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify([{ id: 'a', fitScore: 80, rationale: 'good match' }, { id: 'b', fitScore: 50, rationale: 'okay match' }]),
        inputTokens: 100,
        outputTokens: 20,
      },
    });
    const jobs = [makeJob({ id: 'a', title: 'TypeScript' }), makeJob({ id: 'b', title: 'Go' })];
    const out = await rank(jobs, cfg);
    expect(vi.mocked(callClaude)).toHaveBeenCalledTimes(1);
    const a = out.find((r) => r.job.id === 'a');
    const b = out.find((r) => r.job.id === 'b');
    expect(a?.breakdown.llmFitScore).toBeCloseTo(0.8, 5);
    expect(a?.llmRationale).toBe('good match');
    expect(b?.breakdown.llmFitScore).toBeCloseTo(0.5, 5);
  });
  it('batches LLM calls 5-per-call', async () => {
    const cfg = makeConfig({ ranking: { useLlmFitScore: true, llmModel: 'claude-haiku-4-5', topN: 12, digestK: 10 } });
    vi.mocked(callClaude).mockResolvedValue({
      ok: true,
      value: { text: JSON.stringify([{ id: 'x', fitScore: 70, rationale: 'ok' }]), inputTokens: 1, outputTokens: 1 },
    });
    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < 12; i += 1) {
      jobs.push(makeJob({ id: 'job-' + i, title: 'TypeScript' }));
    }
    await rank(jobs, cfg);
    expect(vi.mocked(callClaude)).toHaveBeenCalledTimes(3);
  });
});
describe('rank — LLM fit-score error handling', () => {
  it('leaves llmFitScore undefined when Claude returns an error', async () => {
    const cfg = makeConfig({ ranking: { useLlmFitScore: true, llmModel: 'claude-haiku-4-5', topN: 5, digestK: 10 } });
    vi.mocked(callClaude).mockResolvedValue({ ok: false, error: { type: 'server', message: 'boom', retryable: true } });
    const out = await rank([makeJob({ title: 'TypeScript' })], cfg);
    expect(out[0]?.breakdown.llmFitScore).toBeUndefined();
    expect(out[0]?.llmRationale).toBeUndefined();
  });
  it('leaves llmFitScore undefined when Claude response is unparseable JSON', async () => {
    const cfg = makeConfig({ ranking: { useLlmFitScore: true, llmModel: 'claude-haiku-4-5', topN: 5, digestK: 10 } });
    vi.mocked(callClaude).mockResolvedValue({ ok: true, value: { text: 'not json at all', inputTokens: 1, outputTokens: 1 } });
    const out = await rank([makeJob({ id: 'a', title: 'TypeScript' })], cfg);
    expect(out[0]?.breakdown.llmFitScore).toBeUndefined();
  });
  it('final score multiplies all three signals', async () => {
    const cfg = makeConfig({ ranking: { useLlmFitScore: true, llmModel: 'claude-haiku-4-5', topN: 5, digestK: 10 } });
    vi.mocked(callClaude).mockResolvedValue({
      ok: true,
      value: { text: JSON.stringify([{ id: 'a', fitScore: 50, rationale: 'mid' }]), inputTokens: 1, outputTokens: 1 },
    });
    const job = makeJob({ id: 'a', title: 'TypeScript', description: 'go python kubernetes' });
    const out = await rank([job], cfg);
    const k = out[0]?.breakdown.keywordOverlap ?? 0;
    const r = out[0]?.breakdown.recencyBoost ?? 0;
    const l = out[0]?.breakdown.llmFitScore ?? 0;
    expect(out[0]?.score).toBeCloseTo(k * r * l, 5);
  });
});
