import { describe, expect, it } from 'vitest';
import { computeBlendScores, seniorityPenaltyFor } from '../../core/pipeline/blend.js';
import type { NormalizedJob } from '../../core/types/index.js';

function job(id: string, title = 'Software Engineer', description = ''): NormalizedJob {
  return {
    id,
    source: 'adzuna',
    url: `https://example.com/${id}`,
    title,
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description,
  };
}

describe('seniorityPenaltyFor', () => {
  it('does not penalize jobs at or below the candidate level', () => {
    expect(seniorityPenaltyFor('entry', 'entry')).toBe(1);
    expect(seniorityPenaltyFor('intern', 'entry')).toBe(1);
  });

  it('penalizes more the further above the candidate level', () => {
    expect(seniorityPenaltyFor('mid', 'entry')).toBe(0.85); // gap 1
    expect(seniorityPenaltyFor('senior', 'entry')).toBe(0.6); // gap 2
    expect(seniorityPenaltyFor('staff', 'entry')).toBe(0.4); // gap 3
  });

  it('scales relative to the candidate, not absolutely', () => {
    expect(seniorityPenaltyFor('staff', 'senior')).toBe(0.85); // gap 1 for a senior candidate
  });

  it('never penalizes when the job level is undetected', () => {
    expect(seniorityPenaltyFor(undefined, 'entry')).toBe(1);
  });
});

describe('computeBlendScores', () => {
  const opts = {
    wBm25: 0.5,
    wSemantic: 0.5,
    seniorityPenalty: false as const,
    candidateLevel: 'entry' as const,
  };

  it('convex-blends min-max-normalized bm25 and semantic', () => {
    const jobs = [job('a'), job('b'), job('c')];
    const bm25 = new Map([
      ['a', 10],
      ['b', 5],
      ['c', 0],
    ]);
    const sem = new Map([
      ['a', 0.9],
      ['b', 0.5],
      ['c', 0.1],
    ]);
    const out = computeBlendScores(jobs, bm25, sem, opts);
    // a is max on both -> 1; c is min on both -> 0; b sits in the middle.
    expect(out.get('a')?.blend).toBeCloseTo(1, 5);
    expect(out.get('c')?.blend).toBeCloseTo(0, 5);
    const b = out.get('b')?.blend ?? 0;
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(1);
  });

  it('collapses to bm25-only when semantic is absent', () => {
    const jobs = [job('a'), job('b')];
    const bm25 = new Map([
      ['a', 10],
      ['b', 0],
    ]);
    const out = computeBlendScores(jobs, bm25, undefined, opts);
    expect(out.get('a')?.blend).toBeCloseTo(1, 5);
    expect(out.get('b')?.blend).toBeCloseTo(0, 5);
  });

  it('respects asymmetric weights', () => {
    const jobs = [job('a'), job('b')];
    const bm25 = new Map([
      ['a', 0],
      ['b', 10],
    ]);
    const sem = new Map([
      ['a', 1],
      ['b', 0],
    ]);
    // Weight semantic 3:1 over bm25 -> a (semantic winner) should outscore b.
    const out = computeBlendScores(jobs, bm25, sem, { ...opts, wBm25: 0.25, wSemantic: 0.75 });
    expect((out.get('a')?.blend ?? 0) > (out.get('b')?.blend ?? 0)).toBe(true);
  });

  it('applies the seniority penalty to over-leveled jobs', () => {
    // staff-role has the STRONGER raw signal (would win without a penalty); the
    // anchor establishes a non-degenerate range so normalization is meaningful.
    const jobs = [
      job('entry-role', 'Software Engineer'),
      job('staff-role', 'Principal Staff Engineer, 15+ years'),
      job('anchor', 'Software Engineer'),
    ];
    const bm25 = new Map([
      ['entry-role', 8],
      ['staff-role', 10],
      ['anchor', 0],
    ]);
    const sem = new Map([
      ['entry-role', 0.8],
      ['staff-role', 0.9],
      ['anchor', 0.1],
    ]);
    const penalized = computeBlendScores(jobs, bm25, sem, {
      ...opts,
      seniorityPenalty: true,
    });
    expect(penalized.get('staff-role')?.penalty).toBeLessThan(1);
    expect(penalized.get('entry-role')?.penalty).toBe(1);
    // The penalty flips the order: the entry role now outscores the higher-raw staff role.
    expect(penalized.get('staff-role')?.blend).toBeLessThan(
      penalized.get('entry-role')?.blend ?? 1,
    );
  });

  it('a degenerate (all-equal) signal contributes nothing', () => {
    const jobs = [job('a'), job('b')];
    const bm25 = new Map([
      ['a', 5],
      ['b', 5],
    ]);
    const sem = new Map([
      ['a', 0.9],
      ['b', 0.1],
    ]);
    const out = computeBlendScores(jobs, bm25, sem, opts);
    // bm25 is flat -> only semantic separates them.
    expect(out.get('a')?.blend).toBeCloseTo(0.5, 5); // 0.5*0 + 0.5*1
    expect(out.get('b')?.blend).toBeCloseTo(0, 5);
  });
});
