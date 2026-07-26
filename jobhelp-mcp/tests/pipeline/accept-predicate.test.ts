import { describe, it, expect } from 'vitest';
import { dropReasonFor, makeAcceptCounter, makeAcceptPredicate, filter } from '../../core/pipeline/filter.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

function makeConfig(): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: [],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend', 'fullstack'],
    },
    sources: {},
    ranking: { topN: 200, digestK: 50, maxAge: { enabled: true, days: 60, requireDate: false } },
    rules: { userRulesDir: '/tmp/rules', mode: 'additive' },
    output: { dir: '/tmp/out' },
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'greenhouse:1',
    source: 'greenhouse',
    url: 'https://example.com/job/1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description:
      'We are hiring a backend engineer to design and operate distributed systems at scale. '
      + 'You will build reliable services, own data pipelines end to end, improve performance, '
      + 'and collaborate with product teams. Strong experience with APIs, databases, and cloud '
      + 'infrastructure is expected, along with a track record of shipping production software.',
    postedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('makeAcceptPredicate', () => {
  const now = new Date();

  it('accepts a job that the full filter keeps', () => {
    const accept = makeAcceptPredicate(makeConfig(), now);
    expect(accept(job())).toBe(true);
  });

  it('rejects a ghost/too-short job', () => {
    const accept = makeAcceptPredicate(makeConfig(), now);
    expect(accept(job({ description: 'short' }))).toBe(false);
  });

  it('rejects an out-of-family role', () => {
    const accept = makeAcceptPredicate(makeConfig(), now);
    expect(accept(job({ title: 'Registered Nurse' }))).toBe(false);
  });

  it('rejects a job under the salary floor', () => {
    const accept = makeAcceptPredicate(makeConfig(), now);
    expect(accept(job({ salaryMax: 50000 }))).toBe(false);
  });

  it('agrees with filter() on a mixed batch (same survivors, same order)', async () => {
    const config = makeConfig();
    const batch = [
      job({ id: 'a', title: 'Backend Engineer' }),
      job({ id: 'b', title: 'Registered Nurse' }),
      job({ id: 'c', title: 'Fullstack Engineer' }),
      job({ id: 'd', description: 'tiny' }),
      job({ id: 'e', title: 'Senior Backend Engineer' }),
    ];
    const accept = makeAcceptPredicate(config, now);
    const viaPredicate = batch.filter((j) => accept(j)).map((j) => j.id);
    const viaFilter = (await filter(batch, config, now)).map((j) => j.id);
    expect(viaPredicate).toEqual(viaFilter);
  });
});

describe('dropReasonFor', () => {
  const now = new Date();

  it('returns undefined for a job the filter keeps', () => {
    expect(dropReasonFor(job(), makeConfig(), now)).toBeUndefined();
  });

  it('names the rule that drops a job', () => {
    expect(dropReasonFor(job({ title: 'Registered Nurse' }), makeConfig(), now)).toBe('non_software');
    expect(dropReasonFor(job({ title: 'Staff Engineer' }), makeConfig(), now)).toBe('strict_senior');
    expect(dropReasonFor(job({ salaryMax: 50000 }), makeConfig(), now)).toBe('salary');
  });

  it('reports only the first matching rule, matching counter attribution', () => {
    const multi = job({ title: 'Registered Nurse', salaryMax: 50000 });
    expect(dropReasonFor(multi, makeConfig(), now)).toBe('non_software');
  });
});

describe('demote-dont-drop policy', () => {
  const now = new Date();

  function entryConfig(): JobDigestConfig {
    const cfg = makeConfig();
    return { ...cfg, profile: { ...cfg.profile, seniority: 'entry' } };
  }

  it('keeps Engineer II titles (demoted in ranking, not dropped)', () => {
    expect(dropReasonFor(job({ title: 'Software Engineer II' }), entryConfig(), now)).toBeUndefined();
  });

  it('still drops Engineer III and IV titles', () => {
    expect(dropReasonFor(job({ title: 'Software Engineer III' }), entryConfig(), now)).toBe('engineer_level');
    expect(dropReasonFor(job({ title: 'Engineer IV, Platform' }), entryConfig(), now)).toBe('engineer_level');
  });

  it('keeps jobs whose only seniority signal lives in the description', () => {
    const descSenior = job({
      title: 'Fullstack Engineer',
      description:
        'We are looking for a Senior Full-Stack Engineer to own features end to end. '
        + 'You will design APIs, operate services, and collaborate with product teams to ship '
        + 'reliable software on a modern cloud stack with strong test coverage.',
    });
    expect(dropReasonFor(descSenior, entryConfig(), now)).toBeUndefined();
  });

  it('still drops on title-level seniority distance', () => {
    const cfg = entryConfig();
    expect(dropReasonFor(job({ title: 'Staff Engineer' }), cfg, now)).toBe('strict_senior');
    expect(dropReasonFor(job({ title: 'Backend Engineer Internship' }), cfg, now)).toBe('intern_mismatch');
  });
});

describe('strictLocation (country_unknown)', () => {
  const now = new Date();

  function strictConfig(strict: boolean): JobDigestConfig {
    const cfg = makeConfig();
    return {
      ...cfg,
      profile: {
        ...cfg.profile,
        allowedCountries: ['US'],
        ...(strict ? { strictLocation: true } : {}),
      },
    };
  }

  it('drops unclassifiable named places when strict', () => {
    expect(dropReasonFor(job({ location: 'Milton Keynes Office' }), strictConfig(true), now)).toBe('country_unknown');
  });

  it('keeps arrangement-only locations even when strict', () => {
    expect(dropReasonFor(job({ location: 'Remote' }), strictConfig(true), now)).toBeUndefined();
    expect(dropReasonFor(job({ location: 'Home based - Worldwide' }), strictConfig(true), now)).toBeUndefined();
    expect(dropReasonFor(job({ location: '' }), strictConfig(true), now)).toBeUndefined();
  });

  it('keeps allowed-country and detectable-US locations when strict', () => {
    expect(dropReasonFor(job({ location: 'Guilford, Connecticut' }), strictConfig(true), now)).toBeUndefined();
    expect(dropReasonFor(job({ location: 'Berlin' }), strictConfig(true), now)).toBe('country');
  });

  it('is off by default: unknown named places survive', () => {
    expect(dropReasonFor(job({ location: 'Milton Keynes Office' }), strictConfig(false), now)).toBeUndefined();
  });
});

describe('makeAcceptCounter', () => {
  const now = new Date();

  it('counts drops per reason across a mixed pool', () => {
    const counter = makeAcceptCounter(makeConfig(), now);
    const batch = [
      job({ id: 'keep1', title: 'Backend Engineer' }),
      job({ id: 'nurse1', title: 'Registered Nurse' }),
      job({ id: 'nurse2', title: 'Registered Nurse, ICU' }),
      job({ id: 'lowpay', salaryMax: 50000 }),
      job({ id: 'staff', title: 'Staff Engineer' }),
      job({ id: 'keep2', title: 'Fullstack Engineer' }),
    ];
    const kept = batch.filter((j) => counter.accept(j));
    expect(kept.map((j) => j.id)).toEqual(['keep1', 'keep2']);
    expect(counter.counts()).toEqual({ non_software: 2, salary: 1, strict_senior: 1 });
    expect(counter.kept()).toBe(2);
  });

  it('returns empty counts and full kept count for a zero-drop pool', () => {
    const counter = makeAcceptCounter(makeConfig(), now);
    const batch = [
      job({ id: 'a', title: 'Backend Engineer' }),
      job({ id: 'b', title: 'Fullstack Engineer' }),
    ];
    for (const j of batch) counter.accept(j);
    expect(counter.counts()).toEqual({});
    expect(counter.kept()).toBe(2);
  });

  it('attributes a drop to the first matching rule only', () => {
    const counter = makeAcceptCounter(makeConfig(), now);
    counter.accept(job({ title: 'Registered Nurse', salaryMax: 50000 }));
    expect(counter.counts()).toEqual({ non_software: 1 });
  });

  it('agrees with filter() on the kept set', async () => {
    const config = makeConfig();
    const batch = [
      job({ id: 'a', title: 'Backend Engineer' }),
      job({ id: 'b', title: 'Registered Nurse' }),
      job({ id: 'c', salaryMax: 40000 }),
      job({ id: 'd', title: 'Fullstack Engineer' }),
      job({ id: 'e', title: 'Staff Engineer' }),
    ];
    const counter = makeAcceptCounter(config, now);
    const viaCounter = batch.filter((j) => counter.accept(j)).map((j) => j.id);
    const viaFilter = (await filter(batch, config, now)).map((j) => j.id);
    expect(viaCounter).toEqual(viaFilter);
    expect(counter.kept()).toBe(viaFilter.length);
  });

  it('counts() reflects a snapshot that later accepts do not mutate', () => {
    const counter = makeAcceptCounter(makeConfig(), now);
    counter.accept(job({ title: 'Registered Nurse' }));
    const snapshot = counter.counts();
    counter.accept(job({ title: 'Registered Nurse, Oncology' }));
    expect(snapshot).toEqual({ non_software: 1 });
    expect(counter.counts()).toEqual({ non_software: 2 });
  });
});
