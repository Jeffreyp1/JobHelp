import { beforeEach, describe, expect, it } from 'vitest';
import { rank } from '../../core/pipeline/rank.js';
import type { Reranker } from '../../core/pipeline/rerank.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import { DEFAULT_RERANK_TOP_K } from '../../core/lib/config-ranking.js';
import { getRecentLogs, __resetForTests } from '../../core/lib/log.js';
import type { NormalizedJob } from '../../core/types/index.js';

function makeJob(id: string, title: string, description: string): NormalizedJob {
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

function makeConfig(
  rankingOverrides: Record<string, unknown>,
  skills: readonly string[] = ['typescript'],
) {
  return validateConfig({
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills,
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

function tsDoc(count: number): string {
  return [...Array<string>(count).fill('typescript'), ...Array<string>(5 - count).fill('filler')].join(
    ' ',
  );
}

const POOL = [
  makeJob('a', 'Job A', tsDoc(4)),
  makeJob('b', 'Job B', tsDoc(3)),
  makeJob('c', 'Job C', tsDoc(2)),
  makeJob('d', 'Job D', tsDoc(1)),
  makeJob('e', 'Job E', tsDoc(0)),
];

type FakeReranker = Reranker & {
  readonly calls: Array<{ query: string; docs: readonly string[] }>;
};

function makeFakeReranker(scoresByTitle: Record<string, number>): FakeReranker {
  const calls: Array<{ query: string; docs: readonly string[] }> = [];
  return {
    calls,
    score: async (query: string, docs: readonly string[]) => {
      calls.push({ query, docs });
      return docs.map((doc) => {
        for (const [prefix, s] of Object.entries(scoresByTitle)) {
          if (doc.startsWith(prefix)) return s;
        }
        return 0;
      });
    },
  };
}

const NOW = new Date('2026-05-15T00:00:00Z');

beforeEach(() => {
  __resetForTests();
});

describe('rank() cross-encoder rerank', () => {
  it('ranks the pool by BM25 without rerank (baseline)', async () => {
    const out = await rank(POOL, makeConfig({}), undefined, NOW);
    expect(out.map((r) => r.job.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is disabled by default and never calls the reranker', async () => {
    const reranker = makeFakeReranker({ 'Job A': 0.1 });
    const out = await rank(POOL, makeConfig({}), undefined, NOW, { reranker });
    expect(reranker.calls).toHaveLength(0);
    expect(out.map((r) => r.job.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out.every((r) => r.breakdown.rerank === undefined)).toBe(true);
  });

  it('reorders only the top-K by cross-encoder score and sets breakdown.rerank', async () => {
    const baseline = await rank(POOL, makeConfig({}), undefined, NOW);
    const reranker = makeFakeReranker({ 'Job A': 0.1, 'Job B': 0.5, 'Job C': 0.9 });
    const out = await rank(
      POOL,
      makeConfig({ rerank: { enabled: true, topK: 3 } }),
      undefined,
      NOW,
      { reranker },
    );
    expect(out.map((r) => r.job.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    const byId = new Map(out.map((r) => [r.job.id, r]));
    expect(byId.get('c')?.breakdown.rerank).toBe(0.9);
    expect(byId.get('b')?.breakdown.rerank).toBe(0.5);
    expect(byId.get('a')?.breakdown.rerank).toBe(0.1);
    expect(byId.get('d')?.breakdown.rerank).toBeUndefined();
    expect(byId.get('e')?.breakdown.rerank).toBeUndefined();
    for (const r of out) {
      expect(r.score).toBe(baseline.find((b) => b.job.id === r.job.id)?.score);
    }
  });

  it('keeps the fusion order for tied rerank scores', async () => {
    const reranker = makeFakeReranker({ 'Job A': 0.7, 'Job B': 0.7, 'Job C': 0.7 });
    const out = await rank(
      POOL,
      makeConfig({ rerank: { enabled: true, topK: 3 } }),
      undefined,
      NOW,
      { reranker },
    );
    expect(out.map((r) => r.job.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out[0]?.breakdown.rerank).toBe(0.7);
  });

  it('passes the profile query and title-plus-truncated-description docs', async () => {
    const longDesc = `typescript ${'x'.repeat(2000)}`;
    const pool = [makeJob('long', 'Job Long', longDesc)];
    const reranker = makeFakeReranker({});
    await rank(pool, makeConfig({ rerank: { enabled: true } }), undefined, NOW, { reranker });
    expect(reranker.calls).toHaveLength(1);
    expect(reranker.calls[0]?.query).toContain('typescript');
    expect(reranker.calls[0]?.docs[0]).toBe(`Job Long. ${longDesc.slice(0, 1500)}`);
  });

  it('reranks the whole list when topK is omitted', async () => {
    const reranker = makeFakeReranker({ 'Job E': 1 });
    const out = await rank(
      POOL,
      makeConfig({ rerank: { enabled: true } }),
      undefined,
      NOW,
      { reranker },
    );
    expect(out[0]?.job.id).toBe('e');
    expect(out.every((r) => r.breakdown.rerank !== undefined)).toBe(true);
  });

  it('falls back to the fusion order when the reranker fails', async () => {
    const broken: Reranker = {
      score: async () => {
        throw new Error('model download failed');
      },
    };
    const out = await rank(
      POOL,
      makeConfig({ rerank: { enabled: true, topK: 3 } }),
      undefined,
      NOW,
      { reranker: broken },
    );
    expect(out.map((r) => r.job.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out.every((r) => r.breakdown.rerank === undefined)).toBe(true);
    expect(getRecentLogs().some((e) => e.msg === 'rank.rerank.unavailable')).toBe(true);
  });

  it('skips reranking when the semantic query text is empty', async () => {
    const reranker = makeFakeReranker({ 'Job E': 1 });
    const out = await rank(
      POOL,
      makeConfig({ rerank: { enabled: true } }, []),
      undefined,
      NOW,
      { reranker },
    );
    expect(reranker.calls).toHaveLength(0);
    expect(out.map((r) => r.job.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('rerank config validation', () => {
  it('defaults to disabled with topK 50', () => {
    const cfg = makeConfig({});
    expect(cfg.ranking.rerank).toEqual({ enabled: false, topK: DEFAULT_RERANK_TOP_K });
  });

  it('passes through a valid block', () => {
    const cfg = makeConfig({ rerank: { enabled: true, topK: 10, model: 'X/y' } });
    expect(cfg.ranking.rerank).toEqual({ enabled: true, topK: 10, model: 'X/y' });
  });

  it('falls back to defaults for invalid topK and blank model', () => {
    const cfg = makeConfig({ rerank: { enabled: true, topK: -3, model: '  ' } });
    expect(cfg.ranking.rerank).toEqual({ enabled: true, topK: DEFAULT_RERANK_TOP_K });
  });
});
