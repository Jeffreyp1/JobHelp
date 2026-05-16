import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { NormalizedJob, RankedJob, SourceRunResult } from '../../core/types/index.js';
import {
  formatDigestMarkdown,
  formatDigestCsv,
  type DigestMeta,
} from '../../core/digest/format.js';

const NOW_ISO = '2026-05-14T20:00:00.000Z';

interface JobOverrides {
  id?: string;
  source?: string;
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  remote?: NormalizedJob['remote'];
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  postedAt?: string | null;
  description?: string;
}

function makeJob(over: JobOverrides = {}): NormalizedJob {
  const base = {
    id: over.id ?? 'greenhouse:stripe-swe-i',
    source: over.source ?? 'greenhouse',
    url: over.url ?? 'https://stripe.com/jobs/listing/123',
    title: over.title ?? 'Software Engineer I',
    company: over.company ?? 'Stripe',
    location: over.location ?? 'Remote (US)',
    remote: over.remote ?? 'remote',
    description: over.description ?? 'Build payments infrastructure. Work with engineers worldwide.',
  };
  const salaryMin = over.salaryMin === undefined ? 130000 : over.salaryMin;
  const salaryMax = over.salaryMax === undefined ? 180000 : over.salaryMax;
  const salaryCurrency = over.salaryCurrency === undefined ? 'USD' : over.salaryCurrency;
  const postedAt = over.postedAt === undefined ? '2026-05-13T10:00:00.000Z' : over.postedAt;
  return {
    ...base,
    ...(salaryMin !== null ? { salaryMin } : {}),
    ...(salaryMax !== null ? { salaryMax } : {}),
    ...(salaryCurrency !== null ? { salaryCurrency } : {}),
    ...(postedAt !== null ? { postedAt } : {}),
  };
}

interface RankedOverrides {
  rank?: number;
  score?: number;
  llmRationale?: string | null;
  breakdown?: RankedJob['breakdown'];
  job?: NormalizedJob;
}

function makeRanked(rank: number, score: number, over: RankedOverrides = {}): RankedJob {
  const llmRationale =
    over.llmRationale === undefined
      ? 'Strong TypeScript and distributed systems match.'
      : over.llmRationale;
  return {
    job: over.job ?? makeJob(),
    rank,
    score,
    breakdown: over.breakdown ?? {
      keywordOverlap: 0.7,
      recencyBoost: 0.97,
      llmFitScore: 0.85,
    },
    ...(llmRationale !== null ? { llmRationale } : {}),
  };
}

const META: DigestMeta = {
  date: '2026-05-14',
  totalDurationMs: 42_000,
  sourceResults: [
    { source: 'greenhouse', jobCount: 8, durationMs: 1200 },
    { source: 'lever', jobCount: 2, durationMs: 900 },
    { source: 'adzuna', jobCount: 0, durationMs: 500, error: { type: 'auth', message: 'bad key' } },
  ],
};

describe('formatDigestMarkdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a multi-job digest', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.87),
      makeRanked(2, 0.74, {
        job: makeJob({
          id: 'lever:plaid-be',
          source: 'lever',
          company: 'Plaid',
          title: 'Backend Engineer',
          url: 'https://jobs.lever.co/plaid/abc',
          location: 'San Francisco, CA',
          remote: 'hybrid',
          salaryMin: 140000,
          salaryMax: 200000,
          postedAt: '2026-05-10T10:00:00.000Z',
        }),
        llmRationale: 'Backend Python and Postgres expertise aligns.',
      }),
    ];
    expect(formatDigestMarkdown(jobs, META)).toMatchSnapshot();
  });

  it('handles an empty digest', () => {
    expect(formatDigestMarkdown([], { ...META, sourceResults: [] })).toMatchSnapshot();
  });

  it('falls back to first sentence of description when no llmRationale', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.6, {
        llmRationale: null,
        job: makeJob({
          description: 'Greenfield service in Go. Pager rotation is light. Equity available.',
        }),
      }),
    ];
    expect(formatDigestMarkdown(jobs, META)).toMatchSnapshot();
  });

  it('renders job with missing optional fields (no salary, no postedAt)', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.55, {
        llmRationale: null,
        job: makeJob({
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          postedAt: null,
          description: 'No description sentence boundary here',
        }),
      }),
    ];
    expect(formatDigestMarkdown(jobs, META)).toMatchSnapshot();
  });

  it('renders salaryMin only / salaryMax only', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.6, {
        job: makeJob({ salaryMin: 120000, salaryMax: null }),
      }),
      makeRanked(2, 0.55, {
        job: makeJob({
          id: 'lever:x',
          salaryMin: null,
          salaryMax: 220000,
        }),
      }),
    ];
    expect(formatDigestMarkdown(jobs, META)).toMatchSnapshot();
  });
});

describe('formatDigestCsv', () => {
  it('renders RFC4180 with header row', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.87),
      makeRanked(2, 0.74, {
        job: makeJob({
          id: 'lever:plaid-be',
          source: 'lever',
          company: 'Plaid',
          title: 'Backend Engineer',
          url: 'https://jobs.lever.co/plaid/abc',
          location: 'San Francisco, CA',
          remote: 'hybrid',
        }),
      }),
    ];
    expect(formatDigestCsv(jobs)).toMatchSnapshot();
  });

  it('handles empty job list (header only)', () => {
    expect(formatDigestCsv([])).toMatchSnapshot();
  });

  it('quotes fields containing comma, quote, or newline', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.9, {
        job: makeJob({
          title: 'Engineer, Backend',
          company: 'Acme "Best" Co',
          location: 'New York, NY',
        }),
      }),
      makeRanked(2, 0.8, {
        job: makeJob({
          id: 'greenhouse:multiline',
          title: 'Multiline\nrole',
          company: 'NewlineCo',
        }),
      }),
    ];
    expect(formatDigestCsv(jobs)).toMatchSnapshot();
  });

  it('emits empty strings for missing optional fields', () => {
    const jobs: readonly RankedJob[] = [
      makeRanked(1, 0.5, {
        job: makeJob({
          salaryMin: null,
          salaryMax: null,
          postedAt: null,
        }),
      }),
    ];
    expect(formatDigestCsv(jobs)).toMatchSnapshot();
  });
});

describe('DigestMeta type', () => {
  it('accepts a shaped meta object', () => {
    const emptyResults: readonly SourceRunResult[] = [];
    const m: DigestMeta = {
      date: '2026-05-14',
      totalDurationMs: 1,
      sourceResults: emptyResults,
    };
    expect(m.date).toBe('2026-05-14');
  });
});
