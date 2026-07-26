import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rank } from '../../core/pipeline/rank.js';
import { buildSemanticRank } from '../../core/pipeline/rrf.js';
import { parseScoreBreakdown } from '../../core/state/digestSchema.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import { DEFAULT_SEMANTIC_CANDIDATE_LIMIT } from '../../core/lib/config-ranking.js';
import { getRecentLogs, __resetForTests } from '../../core/lib/log.js';
import type { Embedder } from '../../core/pipeline/embed.js';
import type { NormalizedJob } from '../../core/types/index.js';

const X_MARKER = 'orchestrated multi agent systems';

function makeJob(id: string, description: string): NormalizedJob {
  return {
    id,
    source: 'adzuna',
    url: `https://example.com/${id}`,
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description,
  };
}

function makeConfig(rankingOverrides: Record<string, unknown>) {
  return validateConfig({
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: ['typescript'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: [],
    },
    ranking: { topN: 10, digestK: 10, ...rankingOverrides },
    output: { dir: '/tmp' },
  });
}

// First embed() call carries the query; later calls carry job docs.
function makeFakeEmbedder(): Embedder & { calls: string[][] } {
  let first = true;
  const calls: string[][] = [];
  return {
    calls,
    embed: async (texts: readonly string[]) => {
      calls.push([...texts]);
      if (first) {
        first = false;
        return texts.map(() => new Float32Array([1, 0]));
      }
      return texts.map((t) =>
        t.includes(X_MARKER) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
      );
    },
  };
}

const FILLERS = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) =>
  makeJob(id, 'TypeScript daily work.'),
);
const X_JOB = makeJob('zz', `We build ${X_MARKER}.`);
const POOL = [...FILLERS, X_JOB];

beforeEach(() => {
  __resetForTests();
});

describe('buildSemanticRank', () => {
  it('orders by similarity desc, missing ids last, ties by id', () => {
    const jobs = [makeJob('a', 'x'), makeJob('b', 'x'), makeJob('c', 'x')];
    const sims = new Map([
      ['b', 0.9],
      ['a', 0.1],
    ]);
    const list = buildSemanticRank(jobs, sims);
    expect(list.items.map((e) => e.job.id)).toEqual(['b', 'a', 'c']);
    expect(list.items.map((e) => e.rank)).toEqual([1, 2, 3]);
  });
});

describe('rank() semantic fusion', () => {
  it('improves the rank of a semantically-close zero-keyword job', async () => {
    const off = await rank(POOL, makeConfig({ fusion: { enabled: true, k: 60 } }));
    const offRank = off.find((r) => r.job.id === 'zz')?.rank;
    expect(offRank).toBe(6);

    const embedder = makeFakeEmbedder();
    const on = await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    const onRank = on.find((r) => r.job.id === 'zz')?.rank;
    expect(onRank).toBeDefined();
    expect(onRank as number).toBeLessThan(6);
  });

  it('records breakdown.semantic for embedded jobs', async () => {
    const embedder = makeFakeEmbedder();
    const on = await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    const x = on.find((r) => r.job.id === 'zz');
    const f1 = on.find((r) => r.job.id === 'f1');
    expect(x?.breakdown.semantic).toBeCloseTo(1, 5);
    expect(f1?.breakdown.semantic).toBeCloseTo(0, 5);
  });

  it('embeds the query in the first call', async () => {
    const embedder = makeFakeEmbedder();
    await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    expect(embedder.calls[0]).toHaveLength(1);
    expect(embedder.calls[0]?.[0]).toContain('typescript');
  });

  it('warns and skips when semantic is enabled without fusion', async () => {
    const embedder = makeFakeEmbedder();
    const out = await rank(
      POOL,
      makeConfig({ semantic: { enabled: true } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    expect(out).toHaveLength(POOL.length);
    expect(embedder.calls).toHaveLength(0);
    expect(
      getRecentLogs().some((e) => e.msg === 'rank.semantic.requires_fusion'),
    ).toBe(true);
  });

  it('does not touch the embedder when semantic is disabled', async () => {
    const embedder = makeFakeEmbedder();
    await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    expect(embedder.calls).toHaveLength(0);
  });

  it('prefixes the query for BGE models', async () => {
    const embedder = makeFakeEmbedder();
    await rank(
      POOL,
      makeConfig({
        fusion: { enabled: true, k: 60 },
        semantic: { enabled: true, model: 'Xenova/bge-small-en-v1.5' },
      }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder },
    );
    expect(embedder.calls[0]).toHaveLength(1);
    expect(
      embedder.calls[0]?.[0]?.startsWith(
        'Represent this sentence for searching relevant passages: ',
      ),
    ).toBe(true);
  });

  it('injected embedders never touch the disk cache', async () => {
    const prev = process.env['JOBHELP_HOME'];
    const home = await mkdtemp(join(tmpdir(), 'jobhelp-home-'));
    process.env['JOBHELP_HOME'] = home;
    try {
      const embedder = makeFakeEmbedder();
      await rank(
        POOL,
        makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
        undefined,
        new Date('2026-05-15T00:00:00Z'),
        { embedder },
      );
      expect(embedder.calls.length).toBeGreaterThan(0);
      expect(existsSync(join(home, 'cache'))).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env['JOBHELP_HOME'];
      } else {
        process.env['JOBHELP_HOME'] = prev;
      }
      await rm(home, { recursive: true, force: true });
    }
  });

  it('degrades gracefully when the embedder throws', async () => {
    const broken: Embedder = {
      embed: async () => {
        throw new Error('model download failed');
      },
    };
    const off = await rank(POOL, makeConfig({ fusion: { enabled: true, k: 60 } }));
    const on = await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
      undefined,
      new Date('2026-05-15T00:00:00Z'),
      { embedder: broken },
    );
    expect(on.map((r) => r.job.id)).toEqual(off.map((r) => r.job.id));
    expect(getRecentLogs().some((e) => e.msg === 'rank.semantic.unavailable')).toBe(true);
  });
});

describe('rank() semantic candidate gating', () => {
  function tsJob(id: string, count: number): NormalizedJob {
    const words = [
      ...Array<string>(count).fill('typescript'),
      ...Array<string>(4 - count).fill('filler'),
    ];
    return makeJob(id, words.join(' '));
  }

  const GATE_POOL = [
    tsJob('g1', 3),
    tsJob('g2', 2),
    tsJob('g3', 0),
    tsJob('g4', 0),
    makeJob('g5', `We build ${X_MARKER}.`),
  ];

  const NOW = new Date('2026-05-15T00:00:00Z');

  it('embeds only the top-candidateLimit jobs by BM25', async () => {
    const embedder = makeFakeEmbedder();
    const out = await rank(
      GATE_POOL,
      makeConfig({
        fusion: { enabled: true, k: 60 },
        semantic: { enabled: true, candidateLimit: 2 },
      }),
      undefined,
      NOW,
      { embedder },
    );
    expect(embedder.calls).toHaveLength(2);
    expect(embedder.calls[1]).toHaveLength(2);
    const byId = new Map(out.map((r) => [r.job.id, r]));
    expect(byId.get('g1')?.breakdown.semantic).toBeDefined();
    expect(byId.get('g2')?.breakdown.semantic).toBeDefined();
    expect(byId.get('g3')?.breakdown.semantic).toBeUndefined();
    expect(byId.get('g4')?.breakdown.semantic).toBeUndefined();
    expect(byId.get('g5')?.breakdown.semantic).toBeUndefined();
  });

  it('breaks BM25 ties by input order', async () => {
    const embedder = makeFakeEmbedder();
    const out = await rank(
      GATE_POOL,
      makeConfig({
        fusion: { enabled: true, k: 60 },
        semantic: { enabled: true, candidateLimit: 3 },
      }),
      undefined,
      NOW,
      { embedder },
    );
    const byId = new Map(out.map((r) => [r.job.id, r]));
    expect(byId.get('g3')?.breakdown.semantic).toBeDefined();
    expect(byId.get('g4')?.breakdown.semantic).toBeUndefined();
    expect(byId.get('g5')?.breakdown.semantic).toBeUndefined();
  });

  it('matches ungated output when the pool is under the limit', async () => {
    const ungated = await rank(
      POOL,
      makeConfig({ fusion: { enabled: true, k: 60 }, semantic: { enabled: true } }),
      undefined,
      NOW,
      { embedder: makeFakeEmbedder() },
    );
    const gated = await rank(
      POOL,
      makeConfig({
        fusion: { enabled: true, k: 60 },
        semantic: { enabled: true, candidateLimit: 100 },
      }),
      undefined,
      NOW,
      { embedder: makeFakeEmbedder() },
    );
    expect(gated).toEqual(ungated);
  });

  it('validates candidateLimit as finite positive with a default fallback', () => {
    const invalid = makeConfig({ semantic: { enabled: true, candidateLimit: -5 } });
    expect(invalid.ranking.semantic?.candidateLimit).toBe(DEFAULT_SEMANTIC_CANDIDATE_LIMIT);
    const valid = makeConfig({ semantic: { enabled: true, candidateLimit: 2 } });
    expect(valid.ranking.semantic?.candidateLimit).toBe(2);
    const absent = makeConfig({ semantic: { enabled: true } });
    expect(absent.ranking.semantic?.candidateLimit).toBeUndefined();
    expect(() =>
      makeConfig({ semantic: { enabled: true, candidateLimit: 'many' } }),
    ).toThrow();
  });
});

describe('digestSchema semantic round-trip', () => {
  it('parses and preserves breakdown.semantic', () => {
    const parsed = parseScoreBreakdown({
      keywordOverlap: 0.5,
      recencyBoost: 1,
      bm25f: 0.2,
      rrf: 0.03,
      semantic: 0.87,
    });
    expect(parsed?.semantic).toBe(0.87);
  });

  it('drops non-finite semantic values', () => {
    const parsed = parseScoreBreakdown({
      keywordOverlap: 0.5,
      recencyBoost: 1,
      bm25f: 0.2,
      semantic: Number.NaN,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.semantic).toBeUndefined();
  });

  it('parses and preserves breakdown.rerank and breakdown.historyBoost', () => {
    const parsed = parseScoreBreakdown({
      keywordOverlap: 0.5,
      recencyBoost: 1,
      bm25f: 0.2,
      rerank: 0.91,
      historyBoost: 1.15,
    });
    expect(parsed?.rerank).toBe(0.91);
    expect(parsed?.historyBoost).toBe(1.15);
  });

  it('drops non-finite rerank and historyBoost values', () => {
    const parsed = parseScoreBreakdown({
      keywordOverlap: 0.5,
      recencyBoost: 1,
      bm25f: 0.2,
      rerank: Number.POSITIVE_INFINITY,
      historyBoost: Number.NaN,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.rerank).toBeUndefined();
    expect(parsed?.historyBoost).toBeUndefined();
  });
});
