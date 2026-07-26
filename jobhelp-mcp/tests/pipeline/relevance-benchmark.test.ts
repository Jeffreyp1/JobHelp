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
import probes from '../fixtures/relevance-probes.json';

// Floors sit ~0.1 below measured values (rho 0.871, pairwise 0.913 at time of
// writing) so ranking tweaks can shift metrics slightly without tripping, while a
// real regression still fails. Hard violations (junk above a strong match) get no slack.
const RHO_FLOOR = 0.77;
const PAIRWISE_FLOOR = 0.81;

const NOW = new Date('2026-07-17T00:00:00Z');

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

const probeJobs: readonly NormalizedJob[] = probes.map((p) => ({
  id: p.id,
  source: 'probe',
  url: `https://example.com/${p.id}`,
  title: p.title,
  company: p.company,
  location: 'Remote (US)',
  remote: 'remote',
  postedAt: '2026-07-16T00:00:00Z',
  description: p.description,
}));

const tierOf = new Map(probes.map((p) => [p.id, p.finalTier]));

type Row = TierRankRow;

async function computeRows(): Promise<readonly Row[]> {
  const ranked = await rank(probeJobs, CONFIG, undefined, NOW, {
    embedder: lexicalEmbedder(),
  });
  return ranked.map((r) => {
    const tier = tierOf.get(r.job.id);
    if (tier === undefined) throw new Error(`unlabeled probe in output: ${r.job.id}`);
    return { id: r.job.id, tier, rank: r.rank };
  });
}

let rowsPromise: Promise<readonly Row[]> | undefined;
function getRows(): Promise<readonly Row[]> {
  rowsPromise ??= computeRows();
  return rowsPromise;
}

describe('relevance benchmark: 22 blind-verified tier-labeled probes (rrf mode)', () => {
  it('ranks all 20 probes', async () => {
    const rows = await getRows();
    expect(rows).toHaveLength(22);
    log('info', 'relevance-benchmark.metrics', {
      spearmanRho: Number(spearman(rows).toFixed(3)),
      pairwiseAccuracy: Number(pairwiseAccuracy(rows).toFixed(3)),
      hardViolations: hardViolations(rows).length,
      order: [...rows].sort((a, b) => a.rank - b.rank).map((r) => `${r.id}#${r.rank}`),
    });
  });

  it('never ranks a T4/T5 probe above any T1/T2 probe', async () => {
    const violations = hardViolations(await getRows());
    expect(violations, violations.join('; ')).toHaveLength(0);
  });

  it(`holds Spearman rho of tier vs rank at or above ${RHO_FLOOR}`, async () => {
    const rho = spearman(await getRows());
    expect(rho, `measured rho ${rho.toFixed(3)}`).toBeGreaterThanOrEqual(RHO_FLOOR);
  });

  it(`holds pairwise cross-tier ordering accuracy at or above ${PAIRWISE_FLOOR}`, async () => {
    const acc = pairwiseAccuracy(await getRows());
    expect(acc, `measured pairwise accuracy ${acc.toFixed(3)}`).toBeGreaterThanOrEqual(
      PAIRWISE_FLOOR,
    );
  });
});
