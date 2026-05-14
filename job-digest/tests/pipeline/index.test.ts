import { describe, it, expect, vi } from 'vitest';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

vi.mock('../../core/lib/claude.js', () => ({ callClaude: vi.fn() }));

import { callClaude } from '../../core/lib/claude.js';
import { runPipeline } from '../../core/pipeline/index.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go', 'python'],
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

function makeJob(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    id: 'adzuna:base',
    source: 'adzuna',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Irvine, CA',
    remote: 'hybrid',
    description: 'Build software in TypeScript and Go.',
    ...overrides,
  };
}
describe('runPipeline', () => {
  it('composes normalize, dedupe, filter, rank end-to-end', async () => {
    vi.mocked(callClaude).mockReset();
    const jobs: readonly NormalizedJob[] = [
      makeJob({ id: 'ok-1', title: 'TypeScript Engineer', description: 'go python', salaryMax: 150000 }),
      makeJob({ id: 'malformed', title: '' }),
      makeJob({ id: 'low-salary', title: 'TypeScript Eng', description: 'go', salaryMax: 50000 }),
      makeJob({ id: 'remote-only', title: 'Engineer', description: 'typescript go', remote: 'remote' }),
      makeJob({ id: 'ok-1', title: 'TypeScript Engineer', description: 'duplicate id' }),
      makeJob({ id: 'ok-2', title: 'Backend Engineer', description: 'we use python and go' }),
      makeJob({ id: 'senior-too-far', title: 'Staff Engineer', description: 'leadership role' }),
    ];
    const cfg = makeConfig({ profile: { ...makeConfig().profile, remoteOk: false, seniority: 'entry' } });
    const out = await runPipeline(jobs, cfg);
    const ids = out.map((r) => r.job.id);
    expect(ids).toContain('ok-1');
    expect(ids).toContain('ok-2');
    expect(ids).not.toContain('malformed');
    expect(ids).not.toContain('low-salary');
    expect(ids).not.toContain('remote-only');
    expect(ids).not.toContain('senior-too-far');
    const okOneOccurrences = ids.filter((id) => id === "ok-1").length;
    expect(okOneOccurrences).toBe(1);
    expect(out.every((r) => r.rank >= 1)).toBe(true);
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1];
      const cur = out[i];
      if (prev !== undefined && cur !== undefined) {
        expect(prev.score).toBeGreaterThanOrEqual(cur.score);
        expect(cur.rank).toBe(prev.rank + 1);
      }
    }
  });

  it('returns an empty list for an empty input', async () => {
    const out = await runPipeline([], makeConfig());
    expect(out).toEqual([]);
  });

  it('drops malformed jobs before they reach rank', async () => {
    const out = await runPipeline([makeJob({ id: '', title: 'TypeScript' })], makeConfig());
    expect(out).toEqual([]);
  });

  it('higher keyword match ranks above lower keyword match', async () => {
    const jobs: readonly NormalizedJob[] = [
      makeJob({ id: 'low-match', title: 'Engineer', description: 'we use python only' }),
      makeJob({ id: 'high-match', title: 'TypeScript Engineer', description: 'we use go python and typescript' }),
    ];
    const out = await runPipeline(jobs, makeConfig());
    expect(out[0]?.job.id).toBe('high-match');
    expect(out[1]?.job.id).toBe('low-match');
  });
});
