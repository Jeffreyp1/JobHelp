import { describe, it, expect } from 'vitest';
import { filter } from '../../core/pipeline/filter.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go'],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend', 'fullstack'],
    },
    sources: {},
    ranking: {
      topN: 20,
      digestK: 10,
    },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/digests' },
  };
  return { ...base, ...overrides };
}

const DEFAULT_DESCRIPTION =
  'We are looking for a backend engineer to build distributed systems in Go and TypeScript. ' +
  'You will own services from design through deployment, work closely with product and infra, ' +
  'and ship features that affect every customer. Strong fundamentals and a curious mindset required.';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'adzuna:abc',
    source: 'adzuna',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: 'hybrid',
    description: DEFAULT_DESCRIPTION,
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

  it('drops an obvious nursing job for a software profile', async () => {
    const out = await filter(
      [
        makeJob({
          title: 'Registered Nurse',
          description:
            'Provide patient care in a clinical setting with charting, triage, and medication support. '.repeat(
              10,
            ),
        }),
      ],
      makeConfig(),
    );
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
    const out = await filter([makeJob({ title: 'Software Engineer' })], cfg);
    expect(out).toHaveLength(1);
  });

  it('detects seniority signal in description as well as title', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'intern' } });
    const longDesc =
      'We need a staff engineer to lead our distributed-systems efforts and own the platform. ' +
      'You will mentor others, set technical direction, and help us scale safely. ' +
      'Experience with Go, Kubernetes, and large-team collaboration is a strong plus.';
    const out = await filter([makeJob({ title: 'Engineer', description: longDesc })], cfg);
    expect(out).toHaveLength(0);
  });

  describe('dropForGhost', () => {
    it('drops [TEMPLATE] Default Template payload', async () => {
      const out = await filter(
        [makeJob({ title: '[TEMPLATE] Default Template' })],
        makeConfig(),
      );
      expect(out).toHaveLength(0);
    });

    it('drops a posting with an empty description', async () => {
      const out = await filter([makeJob({ description: '' })], makeConfig());
      expect(out).toHaveLength(0);
    });

    it('keeps a real SWE job with a full description', async () => {
      const out = await filter([makeJob()], makeConfig());
      expect(out).toHaveLength(1);
    });

    it('drops a real title with a too-short description', async () => {
      const out = await filter(
        [makeJob({ description: 'We are hiring engineers. Apply now.' })],
        makeConfig(),
      );
      expect(out).toHaveLength(0);
    });
  });

  describe('dropForRoleFamily', () => {
    it('drops a PM posting when roleFamily=["backend"]', async () => {
      const cfg = makeConfig({
        profile: { ...makeConfig().profile, roleFamily: ['backend'] },
      });
      const out = await filter([makeJob({ title: 'Product Manager, Sail Core' })], cfg);
      expect(out).toHaveLength(0);
    });

    it('drops an Operations Associate when roleFamily=["backend","fullstack"]', async () => {
      const cfg = makeConfig({
        profile: { ...makeConfig().profile, roleFamily: ['backend', 'fullstack'] },
      });
      const out = await filter(
        [makeJob({ title: 'Operations Associate, GTM Accelerate' })],
        cfg,
      );
      expect(out).toHaveLength(0);
    });

    it('drops a Finance Analyst when roleFamily allows only swe families', async () => {
      const cfg = makeConfig({
        profile: {
          ...makeConfig().profile,
          roleFamily: ['backend', 'fullstack', 'ai-engineer'],
        },
      });
      const out = await filter(
        [makeJob({ title: 'Finance & Strategy Analytics Analyst' })],
        cfg,
      );
      expect(out).toHaveLength(0);
    });

    it('drops an Android Engineer when roleFamily=["backend","fullstack"]', async () => {
      const cfg = makeConfig({
        profile: { ...makeConfig().profile, roleFamily: ['backend', 'fullstack'] },
      });
      const out = await filter([makeJob({ title: 'Android Engineer, Terminal' })], cfg);
      expect(out).toHaveLength(0);
    });

    it('keeps an ambiguous title that the classifier cannot place', async () => {
      const cfg = makeConfig({
        profile: { ...makeConfig().profile, roleFamily: ['backend', 'fullstack'] },
      });
      const out = await filter([makeJob({ title: 'Network Solution Lead' })], cfg);
      expect(out).toHaveLength(1);
    });

    it('empty roleFamily disables the role-family filter (back-compat)', async () => {
      const cfg = makeConfig({
        profile: { ...makeConfig().profile, roleFamily: [] },
      });
      const out = await filter(
        [makeJob({ title: 'Operations Associate, GTM Accelerate' })],
        cfg,
      );
      expect(out).toHaveLength(1);
    });
  });

  describe('strict-senior drop', () => {
    it('drops a Staff Engineer for an entry-level profile', async () => {
      const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'entry' } });
      const out = await filter([makeJob({ title: 'Staff Engineer' })], cfg);
      expect(out).toHaveLength(0);
    });

    it('drops a Principal Engineer for a mid-level profile', async () => {
      const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'mid' } });
      const out = await filter([makeJob({ title: 'Principal Engineer' })], cfg);
      expect(out).toHaveLength(0);
    });

    it('drops a Senior Software Engineer for an entry profile (distance rule regression)', async () => {
      const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'entry' } });
      const out = await filter([makeJob({ title: 'Senior Software Engineer' })], cfg);
      expect(out).toHaveLength(0);
    });

    it('keeps a Senior Software Engineer for a senior profile', async () => {
      const cfg = makeConfig({ profile: { ...makeConfig().profile, seniority: 'senior' } });
      const out = await filter([makeJob({ title: 'Senior Software Engineer' })], cfg);
      expect(out).toHaveLength(1);
    });
  });
});
