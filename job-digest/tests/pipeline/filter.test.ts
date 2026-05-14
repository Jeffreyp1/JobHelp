import { describe, it, expect } from 'vitest';
import { filter } from '../../core/pipeline/filter.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go'],
      location: 'Irvine, CA',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: {
      useLlmFitScore: false,
      llmModel: 'claude-haiku-4-5',
      topN: 20,
      digestK: 10,
    },
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
    remote: 'hybrid',
    description: 'Build software in Go and TypeScript',
    ...overrides,
  };
}

describe('filter', () => {
  it('keeps a baseline job', async () => {
    const out = await filter([makeJob()], makeConfig());
    expect(out).toHaveLength(1);
  });

  it('drops a remote-only job when remoteOk is false', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, remoteOk: false } });
    const out = await filter([makeJob({ remote: 'remote' })], cfg);
    expect(out).toHaveLength(0);
  });

  it('keeps a hybrid job when remoteOk is false', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, remoteOk: false } });
    const out = await filter([makeJob({ remote: 'hybrid' })], cfg);
    expect(out).toHaveLength(1);
  });

  it('keeps a remote job when remoteOk is true', async () => {
    const out = await filter([makeJob({ remote: 'remote' })], makeConfig());
    expect(out).toHaveLength(1);
  });

  it('drops a job where salaryMax is below salaryFloor', async () => {
    const out = await filter([makeJob({ salaryMax: 80000 })], makeConfig());
    expect(out).toHaveLength(0);
  });

  it('keeps a job where salaryMax meets salaryFloor', async () => {
    const out = await filter([makeJob({ salaryMax: 120000 })], makeConfig());
    expect(out).toHaveLength(1);
  });

  it('keeps a job with no salary info (missing data never drops)', async () => {
    const out = await filter([makeJob()], makeConfig());
    expect(out).toHaveLength(1);
  });

  it('drops a senior posting for an intern profile (>=2 steps off)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'intern' } });
    const out = await filter([makeJob({ title: 'Senior Engineer' })], cfg);
    expect(out).toHaveLength(0);
  });

  it('keeps a senior posting for a mid profile (1 step off)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'mid' } });
    const out = await filter([makeJob({ title: 'Senior Engineer' })], cfg);
    expect(out).toHaveLength(1);
  });

  it('drops a staff posting for an entry profile (>=2 steps off)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'entry' } });
    const out = await filter([makeJob({ title: 'Staff Engineer' })], cfg);
    expect(out).toHaveLength(0);
  });

  it('drops an intern posting for a senior profile (>=2 steps off)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'senior' } });
    const out = await filter([makeJob({ title: 'Software Engineer Intern' })], cfg);
    expect(out).toHaveLength(0);
  });

  it('keeps a posting with no seniority signal (missing data never drops)', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'intern' } });
    const out = await filter([makeJob({ title: 'Software Engineer', description: 'Build stuff' })], cfg);
    expect(out).toHaveLength(1);
  });

  it('detects seniority signal in description as well as title', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'intern' } });
    const out = await filter([makeJob({ title: 'Engineer', description: 'We need a staff engineer' })], cfg);
    expect(out).toHaveLength(0);
  });
});
