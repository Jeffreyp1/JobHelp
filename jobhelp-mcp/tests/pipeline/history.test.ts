import { describe, it, expect } from 'vitest';
import { appliedJobIds, historyBoostsFor } from '../../core/pipeline/history.js';
import { rank } from '../../core/pipeline/rank.js';
import { validateHistory } from '../../core/lib/config-ranking.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';
import type { ApplicationEntry } from '../../core/state/index.js';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'greenhouse:1',
    source: 'greenhouse',
    url: 'https://example.com/jobs/1',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description: 'Build software',
    ...overrides,
  };
}

function makeApp(overrides: Partial<ApplicationEntry> = {}): ApplicationEntry {
  return {
    jobId: 'greenhouse:900',
    company: 'acme',
    role: 'Software Engineer',
    date: '2026-05-27',
    dir: '/tmp/apps/acme',
    createdAt: '2026-05-27T05:58:20.231Z',
    updatedAt: '2026-05-27T06:04:56.553Z',
    ...overrides,
  };
}

describe('appliedJobIds', () => {
  it('returns empty for empty applications', () => {
    expect(appliedJobIds([makeJob()], []).size).toBe(0);
  });

  it('matches on identical jobId', () => {
    const job = makeJob({ id: 'greenhouse:7775622', company: 'Other Co', title: 'Different Role' });
    const app = makeApp({ jobId: 'greenhouse:7775622' });
    expect(appliedJobIds([job], [app]).has('greenhouse:7775622')).toBe(true);
  });

  it('matches on identical url', () => {
    const job = makeJob({ url: 'https://stripe.com/jobs/search?gh_jid=7775622' });
    const app = makeApp({ company: 'zzz', role: 'zzz', url: 'https://stripe.com/jobs/search?gh_jid=7775622' });
    expect(appliedJobIds([job], [app]).has(job.id)).toBe(true);
  });

  it('matches urls that differ by trailing slash, hash, and scheme/host case', () => {
    const job = makeJob({ url: 'HTTPS://Jobs.Example.com/roles/42/' });
    const app = makeApp({ company: 'zzz', role: 'zzz', url: 'https://jobs.example.com/roles/42#apply' });
    expect(appliedJobIds([job], [app]).has(job.id)).toBe(true);
  });

  it('does not match urls that differ by query string', () => {
    const job = makeJob({ url: 'https://example.com/jobs/1?gh_jid=1' });
    const app = makeApp({ company: 'zzz', role: 'zzz', url: 'https://example.com/jobs/1?gh_jid=2' });
    expect(appliedJobIds([job], [app]).size).toBe(0);
  });

  it('ignores unparseable urls without crashing', () => {
    const job = makeJob({ url: 'not a url', company: 'zzz' });
    const app = makeApp({ company: 'yyy', role: 'yyy', url: 'also not a url' });
    expect(appliedJobIds([job], [app]).size).toBe(0);
  });

  it('matches company+title despite case, punctuation, and slugged company', () => {
    const job = makeJob({ company: 'Abnormal Security', title: 'AI Product Engineer' });
    const app = makeApp({ company: 'abnormalsecurity', role: 'ai   product engineer.' });
    expect(appliedJobIds([job], [app]).has(job.id)).toBe(true);
  });

  it('matches company+title with reordered title tokens (token-set equality)', () => {
    const job = makeJob({ company: 'Acme', title: 'Backend Engineer, Senior' });
    const app = makeApp({ company: 'acme', role: 'Senior Backend Engineer' });
    expect(appliedJobIds([job], [app]).has(job.id)).toBe(true);
  });

  it('stays unmatched when company matches but title differs by a token', () => {
    const job = makeJob({ company: 'Acme', title: 'Senior Backend Engineer' });
    const app = makeApp({ company: 'acme', role: 'Staff Backend Engineer' });
    expect(appliedJobIds([job], [app]).size).toBe(0);
  });

  it('stays unmatched when title matches but company differs', () => {
    const job = makeJob({ company: 'Acme', title: 'Software Engineer' });
    const app = makeApp({ company: 'globex', role: 'Software Engineer' });
    expect(appliedJobIds([job], [app]).size).toBe(0);
  });

  it('does not treat empty title token sets as equal', () => {
    const job = makeJob({ company: 'Acme', title: '!!' });
    const app = makeApp({ company: 'acme', role: '??' });
    expect(appliedJobIds([job], [app]).size).toBe(0);
  });
});

describe('historyBoostsFor', () => {
  it('returns empty for empty applications', () => {
    expect(historyBoostsFor([makeJob()], []).size).toBe(0);
  });

  it('gives full default cap for a normalized-company match', () => {
    const job = makeJob({ company: 'Abnormal Security', title: 'Totally Different Role Here' });
    const app = makeApp({ company: 'abnormalsecurity', role: 'AI Product Engineer' });
    expect(historyBoostsFor([job], [app]).get(job.id)).toBe(1.15);
  });

  it('respects a custom cap', () => {
    const job = makeJob({ company: 'Acme', title: 'Totally Different Role Here' });
    const app = makeApp({ company: 'acme', role: 'AI Product Engineer' });
    expect(historyBoostsFor([job], [app], { cap: 1.5 }).get(job.id)).toBe(1.5);
  });

  it('boosts by title similarity scaled linearly between 0.4 and 1', () => {
    const job = makeJob({ company: 'Acme', title: 'alpha beta gamma' });
    const app = makeApp({ company: 'globex', role: 'alpha beta gamma delta' });
    const boost = historyBoostsFor([job], [app]).get(job.id);
    expect(boost).toBeCloseTo(1 + 0.15 * ((0.75 - 0.4) / 0.6), 10);
  });

  it('includes a job at exactly 0.4 similarity with multiplier 1', () => {
    const job = makeJob({ company: 'Acme', title: 'alpha beta gamma' });
    const app = makeApp({ company: 'globex', role: 'alpha beta delta epsilon' });
    expect(historyBoostsFor([job], [app]).get(job.id)).toBe(1);
  });

  it('omits a job below the 0.4 similarity floor', () => {
    const job = makeJob({ company: 'Acme', title: 'alpha beta gamma delta epsilon' });
    const app = makeApp({ company: 'globex', role: 'alpha beta zeta eta theta' });
    expect(historyBoostsFor([job], [app]).size).toBe(0);
  });

  it('takes the max across applications', () => {
    const job = makeJob({ company: 'Acme', title: 'alpha beta gamma' });
    const weak = makeApp({ company: 'globex', role: 'alpha beta delta epsilon' });
    const strong = makeApp({ company: 'acme', role: 'Totally Different Role Here' });
    expect(historyBoostsFor([job], [weak, strong]).get(job.id)).toBe(1.15);
  });

  it('never boosts a job already identified as applied', () => {
    const job = makeJob({ id: 'greenhouse:7775622', company: 'Acme', title: 'Software Engineer' });
    const app = makeApp({ jobId: 'greenhouse:7775622', company: 'acme', role: 'Software Engineer' });
    expect(historyBoostsFor([job], [app]).has('greenhouse:7775622')).toBe(false);
  });

  it('is deterministic across calls', () => {
    const jobs = [
      makeJob({ id: 'a', company: 'Acme', title: 'alpha beta gamma' }),
      makeJob({ id: 'b', company: 'Globex', title: 'Different Thing Entirely' }),
    ];
    const apps = [
      makeApp({ company: 'acme', role: 'alpha beta gamma delta' }),
      makeApp({ company: 'initech', role: 'Different Thing Entirely' }),
    ];
    const first = historyBoostsFor(jobs, apps);
    const second = historyBoostsFor(jobs, apps);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect([...appliedJobIds(jobs, apps)]).toEqual([...appliedJobIds(jobs, apps)]);
  });
});

describe('rank integration', () => {
  const DESCRIPTION =
    'Build distributed systems in TypeScript and Go. Own services end to end and ship weekly.';

  function makeConfig(history?: { enabled: boolean; boostCap?: number }): JobDigestConfig {
    return {
      profile: {
        resumeDumpPath: '/tmp/resume.md',
        skills: ['typescript', 'go'],
        location: 'Austin, TX',
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
        ...(history !== undefined ? { history } : {}),
      },
      rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
      output: { dir: '/tmp/digests' },
    };
  }

  const twin = (id: string, company: string): NormalizedJob =>
    makeJob({ id, company, url: `https://example.com/jobs/${id}`, description: DESCRIPTION });

  it('company-match boost flips the order of otherwise-identical jobs and records breakdown.historyBoost', async () => {
    const jobs = [twin('greenhouse:a', 'Acme'), twin('greenhouse:b', 'Beta Corp')];
    const apps = [makeApp({ company: 'betacorp', role: 'Site Reliability Engineer' })];
    const ranked = await rank(jobs, makeConfig({ enabled: true }), undefined, new Date(), {
      applications: apps,
    });
    expect(ranked[0]?.job.id).toBe('greenhouse:b');
    expect(ranked[0]?.breakdown.historyBoost).toBeCloseTo(1.15, 10);
    expect(ranked[1]?.breakdown.historyBoost).toBeUndefined();
  });

  it('history disabled leaves order and breakdown untouched', async () => {
    const jobs = [twin('greenhouse:a', 'Acme'), twin('greenhouse:b', 'Beta Corp')];
    const apps = [makeApp({ company: 'betacorp', role: 'Site Reliability Engineer' })];
    const ranked = await rank(jobs, makeConfig(), undefined, new Date(), { applications: apps });
    expect(ranked[0]?.job.id).toBe('greenhouse:a');
    expect(ranked.every((r) => r.breakdown.historyBoost === undefined)).toBe(true);
  });

  it('an already-applied job is never boosted (while a similar-title job elsewhere is)', async () => {
    const jobs = [twin('greenhouse:a', 'Acme'), twin('greenhouse:b', 'Beta Corp')];
    const apps = [makeApp({ company: 'betacorp', role: 'Software Engineer' })];
    const ranked = await rank(jobs, makeConfig({ enabled: true }), undefined, new Date(), {
      applications: apps,
    });
    const applied = ranked.find((r) => r.job.id === 'greenhouse:b');
    const similar = ranked.find((r) => r.job.id === 'greenhouse:a');
    expect(applied?.breakdown.historyBoost).toBeUndefined();
    expect(similar?.breakdown.historyBoost).toBeCloseTo(1.15, 10);
    expect(ranked[0]?.job.id).toBe('greenhouse:a');
  });

  it('boostCap from config scales the multiplier', async () => {
    const jobs = [twin('greenhouse:a', 'Acme'), twin('greenhouse:b', 'Beta Corp')];
    const apps = [makeApp({ company: 'betacorp', role: 'Site Reliability Engineer' })];
    const ranked = await rank(
      jobs,
      makeConfig({ enabled: true, boostCap: 1.4 }),
      undefined,
      new Date(),
      { applications: apps },
    );
    expect(ranked[0]?.breakdown.historyBoost).toBeCloseTo(1.4, 10);
  });
});

describe('validateHistory', () => {
  it('returns disabled defaults for undefined', () => {
    expect(validateHistory(undefined)).toEqual({ enabled: false, boostCap: 1.15 });
  });

  it('parses enabled with a custom cap', () => {
    expect(validateHistory({ enabled: true, boostCap: 1.3 })).toEqual({
      enabled: true,
      boostCap: 1.3,
    });
  });

  it('falls back to the default cap when boostCap is below 1', () => {
    expect(validateHistory({ enabled: true, boostCap: 0.5 })).toEqual({
      enabled: true,
      boostCap: 1.15,
    });
  });
});
