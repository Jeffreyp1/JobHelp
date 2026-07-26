import { describe, expect, it } from 'vitest';
import { partitionByVerdict } from '../../core/pipeline/verdicts.js';
import { identityKey } from '../../core/pipeline/identity.js';
import { rank } from '../../core/pipeline/rank.js';
import { runPipeline } from '../../core/pipeline/index.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';
import type { JobVerdict, JobVerdictEntry } from '../../core/state/index.js';

const DESCRIPTION =
  'Build distributed systems in TypeScript and Go. We are a small high-leverage team building ' +
  'reliable services and shipping product end-to-end. You will own services, contribute to ' +
  'architecture, and pair with product on iteration. Strong fundamentals matter most here.';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'greenhouse:1',
    source: 'greenhouse',
    url: 'https://example.com/jobs/1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description: DESCRIPTION,
    ...overrides,
  };
}

function makeVerdict(
  company: string,
  title: string,
  verdict: JobVerdict,
  overrides: Partial<JobVerdictEntry> = {},
): JobVerdictEntry {
  return {
    identityKey: identityKey(company, title),
    company,
    title,
    verdict,
    at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConfig(): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 0,
      seniority: 'entry',
      roleFamily: [],
    },
    sources: {},
    ranking: {
      topN: 20,
      digestK: 10,
      recency: { enabled: false, halfLifeDays: 21 },
    },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/digests' },
  };
}

describe('partitionByVerdict', () => {
  it('returns empty partitions when there are no verdicts', () => {
    const out = partitionByVerdict([makeJob()], []);
    expect(out.suppressedJobIds.size).toBe(0);
    expect(out.demotions.size).toBe(0);
  });

  it('suppresses on exact identityKey match despite different jobId and url', () => {
    const job = makeJob({
      id: 'lever:999',
      url: 'https://totally.different/apply',
      company: 'Abnormal Security',
      title: 'Backend Engineer, Senior',
    });
    const verdict = makeVerdict('abnormal-security', 'Senior Backend Engineer', 'drop');
    const out = partitionByVerdict([job], [verdict]);
    expect(out.suppressedJobIds.has('lever:999')).toBe(true);
  });

  it('never matches on company alone: a different role at the same company survives', () => {
    const designer = makeJob({ id: 'greenhouse:2', company: 'Acme', title: 'Product Designer' });
    const verdict = makeVerdict('Acme', 'Backend Engineer', 'drop');
    const out = partitionByVerdict([designer], [verdict]);
    expect(out.suppressedJobIds.size).toBe(0);
    expect(out.demotions.size).toBe(0);
  });

  it('never matches when titles overlap but companies differ', () => {
    const job = makeJob({ id: 'greenhouse:3', company: 'Globex', title: 'Backend Engineer' });
    const verdict = makeVerdict('Acme', 'Backend Engineer', 'drop');
    const out = partitionByVerdict([job], [verdict]);
    expect(out.suppressedJobIds.size).toBe(0);
  });

  it('matches at title-token jaccard exactly 0.6 with the same company', () => {
    const job = makeJob({ id: 'j', company: 'Acme', title: 'alpha beta gamma' });
    const verdict = makeVerdict('Acme', 'alpha beta gamma delta epsilon', 'drop');
    const out = partitionByVerdict([job], [verdict]);
    expect(out.suppressedJobIds.has('j')).toBe(true);
  });

  it('does not match below the 0.6 jaccard threshold even with the same company', () => {
    const job = makeJob({ id: 'j', company: 'Acme', title: 'alpha beta gamma' });
    const verdict = makeVerdict('Acme', 'alpha beta delta epsilon', 'drop');
    const out = partitionByVerdict([job], [verdict]);
    expect(out.suppressedJobIds.size).toBe(0);
  });

  it("maps 'skipped' to a 0.5 demotion and leaves other verdicts neutral", () => {
    const skipped = makeJob({ id: 'skip', company: 'Acme', title: 'Backend Engineer' });
    const strong = makeJob({ id: 'keep', company: 'Globex', title: 'Platform Engineer' });
    const verdicts = [
      makeVerdict('Acme', 'Backend Engineer', 'skipped'),
      makeVerdict('Globex', 'Platform Engineer', 'strong'),
    ];
    const out = partitionByVerdict([skipped, strong], verdicts);
    expect(out.demotions.get('skip')).toBe(0.5);
    expect(out.demotions.has('keep')).toBe(false);
    expect(out.suppressedJobIds.size).toBe(0);
  });

  it('drop wins when both a drop and a skipped verdict match the same job', () => {
    const job = makeJob({ id: 'j', company: 'Acme', title: 'Backend Engineer' });
    const verdicts = [
      makeVerdict('Acme', 'Backend Engineer', 'skipped'),
      makeVerdict('Acme', 'Backend Engineer, Remote', 'drop'),
    ];
    const out = partitionByVerdict([job], verdicts);
    expect(out.suppressedJobIds.has('j')).toBe(true);
    expect(out.demotions.has('j')).toBe(false);
  });
});

describe('runPipeline verdict suppression', () => {
  it('a drop recorded on an earlier posting suppresses a later-run job with new jobId and url', async () => {
    const dropped = makeJob({
      id: 'greenhouse:new-posting',
      url: 'https://boards.example.com/new-posting',
      company: 'Acme',
      title: 'Backend Engineer',
    });
    const survivor = makeJob({
      id: 'greenhouse:other',
      url: 'https://boards.example.com/other',
      company: 'Acme',
      title: 'Product Designer',
    });
    const verdicts = [makeVerdict('Acme', 'Backend Engineer', 'drop', { jobId: 'greenhouse:old' })];
    const out = await runPipeline([dropped, survivor], makeConfig(), { verdicts });
    const ids = out.map((r) => r.job.id);
    expect(ids).not.toContain('greenhouse:new-posting');
    expect(ids).toContain('greenhouse:other');
  });

  it('a skipped verdict demotes but does not remove the job', async () => {
    const twinA = makeJob({ id: 'a', company: 'Acme', url: 'https://example.com/a' });
    const twinB = makeJob({
      id: 'b',
      company: 'Beta Corp',
      title: 'Backend Engineer',
      url: 'https://example.com/b',
    });
    const verdicts = [makeVerdict('Acme', 'Backend Engineer', 'skipped')];
    const out = await runPipeline([twinA, twinB], makeConfig(), { verdicts });
    const a = out.find((r) => r.job.id === 'a');
    const b = out.find((r) => r.job.id === 'b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.breakdown.verdictDemotion).toBe(0.5);
    expect(b?.breakdown.verdictDemotion).toBeUndefined();
    expect(out[0]?.job.id).toBe('b');
  });
});

describe('rank verdict demotion', () => {
  it('halves the final score of a demoted job relative to an identical twin', async () => {
    const twinA = makeJob({ id: 'a', company: 'Acme', url: 'https://example.com/a' });
    const twinB = makeJob({ id: 'b', company: 'Beta Corp', url: 'https://example.com/b' });
    const demotions = new Map([['a', 0.5]]);
    const ranked = await rank([twinA, twinB], makeConfig(), undefined, new Date(), { demotions });
    const a = ranked.find((r) => r.job.id === 'a');
    const b = ranked.find((r) => r.job.id === 'b');
    expect(a?.score).toBeCloseTo((b?.score ?? 0) * 0.5, 10);
    expect(a?.breakdown.verdictDemotion).toBe(0.5);
    expect(b?.breakdown.verdictDemotion).toBeUndefined();
    expect(ranked[0]?.job.id).toBe('b');
  });
});
