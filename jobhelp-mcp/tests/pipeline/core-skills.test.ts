import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../core/lib/config-validation.js';
import { buildSemanticQueryText } from '../../core/pipeline/semanticQuery.js';
import { buildRankPrecomputed } from '../../core/pipeline/rankQuery.js';
import { rank } from '../../core/pipeline/rank.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

function rawConfig(coreSkills?: readonly string[]): Record<string, unknown> {
  return {
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: ['kafka', 'react', 'postgresql'],
      ...(coreSkills !== undefined ? { coreSkills } : {}),
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: ['backend'],
    },
    ranking: {
      topN: 20,
      digestK: 20,
      fusion: { enabled: true, k: 60, mode: 'rrf', seniorityPenalty: true },
    },
    output: { dir: '/tmp' },
  };
}

function job(id: string, description: string): NormalizedJob {
  return {
    id,
    source: 'test',
    url: `https://example.com/${id}`,
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    postedAt: '2026-07-19T00:00:00Z',
    description,
  };
}

describe('coreSkills config', () => {
  it('is optional and absent by default', () => {
    expect(validateConfig(rawConfig()).profile.coreSkills).toBeUndefined();
  });

  it('accepts a string array and preserves it', () => {
    const cfg = validateConfig(rawConfig(['kafka', 'agentic workflows']));
    expect(cfg.profile.coreSkills).toEqual(['kafka', 'agentic workflows']);
  });

  it('rejects non-string-array values', () => {
    const bad = rawConfig();
    (bad['profile'] as Record<string, unknown>)['coreSkills'] = 'kafka';
    expect(() => validateConfig(bad)).toThrow();
  });
});

describe('coreSkills in the semantic query', () => {
  it('leads with a specialization sentence and removes duplicates from the skilled list', () => {
    const cfg = validateConfig(rawConfig(['kafka']));
    const text = buildSemanticQueryText(cfg.profile);
    expect(text).toContain('Specializing in kafka.');
    expect(text).toContain('Skilled in react and postgresql.');
    expect(text.indexOf('Specializing')).toBeLessThan(text.indexOf('Skilled'));
  });

  it('is unchanged when coreSkills is absent', () => {
    const cfg = validateConfig(rawConfig());
    const text = buildSemanticQueryText(cfg.profile);
    expect(text).not.toContain('Specializing');
    expect(text).toContain('Skilled in kafka, react, and postgresql.');
  });
});

describe('coreSkills as a rank-fusion vote', () => {
  const template = (skill: string): string =>
    `You will build data systems with ${skill} and operate them in production at scale. `
    + 'Our platform team owns ingestion, processing, and delivery for analytics workloads.';
  const DESC_A = template('kafka');
  const DESC_B = template('react');

  it('precomputes separate core query terms', () => {
    const cfg = validateConfig(rawConfig(['kafka'])) as JobDigestConfig;
    const pc = buildRankPrecomputed([job('a', DESC_A)], cfg);
    expect(pc.coreQueryTerms).toEqual(['kafka']);
    expect(pc.queryTerms).toContain('react');
  });

  // Ten no-match fillers give the lists realistic depth: the non-core twin sinks
  // among the zero-score group in the core list, which is how the vote works at
  // pool scale. Ids keep the react twin winning every deterministic tiebreak, so
  // the core vote must actively flip the order.
  function pool(): NormalizedJob[] {
    const fillers = Array.from({ length: 10 }, (_, i) => ({
      ...job(`f${String(i).padStart(2, '0')}`, 'Coordinate vendor onboarding and prepare weekly status reports for leadership.'),
      title: 'Operations Analyst',
    }));
    return [job('m-reactjob', DESC_B), job('n-kafkajob', DESC_A), ...fillers];
  }

  it('ranks the core-skill match above an equal non-core match', async () => {
    const cfg = validateConfig(rawConfig(['kafka'])) as JobDigestConfig;
    const ranked = await rank(pool(), cfg, undefined, new Date('2026-07-20T00:00:00Z'));
    const pos = new Map(ranked.map((r) => [r.job.id, r.rank]));
    expect(pos.get('n-kafkajob')).toBeLessThan(pos.get('m-reactjob') ?? 0);
  });

  it('without coreSkills the symmetric twins fall back to the id tiebreak', async () => {
    const cfg = validateConfig(rawConfig()) as JobDigestConfig;
    const ranked = await rank(pool(), cfg, undefined, new Date('2026-07-20T00:00:00Z'));
    const pos = new Map(ranked.map((r) => [r.job.id, r.rank]));
    expect(pos.get('m-reactjob')).toBeLessThan(pos.get('n-kafkajob') ?? 0);
  });
});
