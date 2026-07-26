import { describe, expect, it } from 'vitest';
import { rank } from '../../core/pipeline/rank.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import { log } from '../../core/lib/log.js';
import type { NormalizedJob } from '../../core/types/index.js';
import { lexicalEmbedder } from './helpers/lexical-embedder.js';
import {
  hardViolations,
  pairwiseAccuracy,
  spearman,
  type TierRankRow,
} from './helpers/rank-metrics.js';
import probes from '../fixtures/relevance-probes-live.json';

// Real pool jobs, blind-rated by three independent verifiers (median tier, spread <= 1).
// The holdout split exists to catch overfitting: iterate ranking changes against DEV ONLY,
// and consult holdout at decision points. Do not tune until holdout floors barely pass.
// Floors sit ~0.05-0.07 below measured values with the lexical CI embedder (after the
// role-noun/level-fit round: dev rho 0.802 / pairwise 0.869 / 10 T4 violations; holdout
// 0.795 / 0.865 / 6). T5-above-T1/T2 was zero at creation and gets no slack.
const DEV_RHO_FLOOR = 0.7;
const DEV_PAIRWISE_FLOOR = 0.79;
const DEV_T4_VIOLATION_CEILING = 14;
const HOLDOUT_RHO_FLOOR = 0.73;
const HOLDOUT_PAIRWISE_FLOOR = 0.81;
const HOLDOUT_T4_VIOLATION_CEILING = 10;

const NOW = new Date('2026-07-19T00:00:00Z');

const SKILLS = [
  'typescript', 'python', 'go', 'node.js', 'react', 'aws', 'lambda',
  'postgresql', 'redis', 'kafka', 'docker', 'llm', 'claude', 'rag',
  'agentic', 'multi-agent', 'backend', 'distributed', 'ai', 'engineer',
];

const CONFIG = validateConfig({
  profile: {
    resumeDumpPath: '/tmp/r.md',
    skills: SKILLS,
    location: 'Remote',
    remoteOk: true,
    salaryFloor: 1,
    seniority: 'entry',
    roleFamily: ['ml', 'backend', 'fullstack', 'devops'],
  },
  ranking: {
    topN: 20,
    digestK: 20,
    fusion: { enabled: true, k: 60, mode: 'rrf', seniorityPenalty: true },
    semantic: { enabled: true },
  },
  output: { dir: '/tmp' },
});

type Split = 'dev' | 'holdout';

function probeJobs(split: Split): readonly NormalizedJob[] {
  return probes
    .filter((p) => p.split === split)
    .map((p) => ({
      id: p.id,
      source: 'probe',
      url: `https://example.com/${p.id}`,
      title: p.title,
      company: p.company,
      location: 'Remote (US)',
      remote: 'remote',
      postedAt: '2026-07-18T00:00:00Z',
      description: p.description,
    }));
}

const tierOf = new Map(probes.map((p) => [p.id, p.finalTier]));
const rowCache = new Map<Split, Promise<readonly TierRankRow[]>>();

function rowsFor(split: Split): Promise<readonly TierRankRow[]> {
  let cached = rowCache.get(split);
  if (cached === undefined) {
    cached = rank(probeJobs(split), CONFIG, undefined, NOW, { embedder: lexicalEmbedder() }).then(
      (ranked) =>
        ranked.map((r) => {
          const tier = tierOf.get(r.job.id);
          if (tier === undefined) throw new Error(`unlabeled probe in output: ${r.job.id}`);
          return { id: r.job.id, tier, rank: r.rank };
        }),
    );
    rowCache.set(split, cached);
  }
  return cached;
}

describe('live relevance probe fixture', () => {
  it('has unique ids, valid tiers/splits, and tight verifier consensus', () => {
    expect(new Set(probes.map((p) => p.id)).size).toBe(probes.length);
    for (const p of probes) {
      expect(p.finalTier).toBeGreaterThanOrEqual(1);
      expect(p.finalTier).toBeLessThanOrEqual(5);
      expect(['dev', 'holdout']).toContain(p.split);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThanOrEqual(300);
      const spread = Math.max(...p.verifierTiers) - Math.min(...p.verifierTiers);
      expect(spread).toBeLessThanOrEqual(1);
    }
  });
});

describe('live relevance benchmark: dev split', () => {
  it('ranks every dev probe and logs metrics', async () => {
    const rows = await rowsFor('dev');
    expect(rows).toHaveLength(probes.filter((p) => p.split === 'dev').length);
    log('info', 'relevance-benchmark-live.dev.metrics', {
      spearmanRho: Number(spearman(rows).toFixed(3)),
      pairwiseAccuracy: Number(pairwiseAccuracy(rows).toFixed(3)),
      hardViolations: hardViolations(rows),
    });
  });

  it(`holds Spearman rho at or above ${DEV_RHO_FLOOR}`, async () => {
    const rho = spearman(await rowsFor('dev'));
    expect(rho, `measured rho ${rho.toFixed(3)}`).toBeGreaterThanOrEqual(DEV_RHO_FLOOR);
  });

  it(`holds pairwise cross-tier accuracy at or above ${DEV_PAIRWISE_FLOOR}`, async () => {
    const acc = pairwiseAccuracy(await rowsFor('dev'));
    expect(acc, `measured pairwise ${acc.toFixed(3)}`).toBeGreaterThanOrEqual(DEV_PAIRWISE_FLOOR);
  });

  it('never ranks a T5 probe above any T1/T2 probe', async () => {
    const rows = await rowsFor('dev');
    const t5 = hardViolations(rows.filter((r) => r.tier !== 4));
    expect(t5, t5.join('; ')).toHaveLength(0);
  });

  it(`keeps T4-above-T1/T2 violations at or below ${DEV_T4_VIOLATION_CEILING}`, async () => {
    const all = hardViolations(await rowsFor('dev'));
    expect(all.length, all.join('; ')).toBeLessThanOrEqual(DEV_T4_VIOLATION_CEILING);
  });
});

describe('live relevance benchmark: holdout split (do not tune against this)', () => {
  it('ranks every holdout probe and logs metrics', async () => {
    const rows = await rowsFor('holdout');
    expect(rows).toHaveLength(probes.filter((p) => p.split === 'holdout').length);
    log('info', 'relevance-benchmark-live.holdout.metrics', {
      spearmanRho: Number(spearman(rows).toFixed(3)),
      pairwiseAccuracy: Number(pairwiseAccuracy(rows).toFixed(3)),
      hardViolations: hardViolations(rows),
    });
  });

  it(`holds Spearman rho at or above ${HOLDOUT_RHO_FLOOR}`, async () => {
    const rho = spearman(await rowsFor('holdout'));
    expect(rho, `measured rho ${rho.toFixed(3)}`).toBeGreaterThanOrEqual(HOLDOUT_RHO_FLOOR);
  });

  it(`holds pairwise cross-tier accuracy at or above ${HOLDOUT_PAIRWISE_FLOOR}`, async () => {
    const acc = pairwiseAccuracy(await rowsFor('holdout'));
    expect(acc, `measured pairwise ${acc.toFixed(3)}`).toBeGreaterThanOrEqual(HOLDOUT_PAIRWISE_FLOOR);
  });

  it('never ranks a T5 probe above any T1/T2 probe', async () => {
    const rows = await rowsFor('holdout');
    const t5 = hardViolations(rows.filter((r) => r.tier !== 4));
    expect(t5, t5.join('; ')).toHaveLength(0);
  });

  it(`keeps T4-above-T1/T2 violations at or below ${HOLDOUT_T4_VIOLATION_CEILING}`, async () => {
    const all = hardViolations(await rowsFor('holdout'));
    expect(all.length, all.join('; ')).toBeLessThanOrEqual(HOLDOUT_T4_VIOLATION_CEILING);
  });
});
