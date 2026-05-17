import { describe, it, expect } from 'vitest';
import {
  buildCorpus,
  scoreBM25F,
  DEFAULT_BM25_PARAMS,
  type BM25Doc,
  type BM25Params,
} from '../../core/pipeline/bm25.js';
import { tokenize } from '../../core/pipeline/tokenize.js';

const tok = (s: string): readonly string[] => tokenize(s);

function doc(over: Partial<BM25Doc> = {}): BM25Doc {
  return { title: '', description: '', company: '', location: '', ...over };
}

describe('bm25 — empty / single / extreme corpus boundary inputs', () => {
  it('empty corpus has N=0, df.size=0, all avgFieldLengths=0', () => {
    const c = buildCorpus([], tok);
    expect(c.N).toBe(0);
    expect(c.df.size).toBe(0);
    expect(c.avgFieldLengths.title).toBe(0);
    expect(c.avgFieldLengths.description).toBe(0);
    expect(c.avgFieldLengths.company).toBe(0);
    expect(c.avgFieldLengths.location).toBe(0);
  });

  it('scoreBM25F against an empty corpus returns 0 (no NaN, no throw)', () => {
    const c = buildCorpus([], tok);
    const s = scoreBM25F(c, doc({ title: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
    expect(Number.isNaN(s)).toBe(false);
  });

  it('single-doc corpus: every term has df=1; score finite and >0', () => {
    const c = buildCorpus([doc({ title: 'kafka' })], tok);
    expect(c.N).toBe(1);
    expect(c.df.get('kafka')).toBe(1);
    const s = scoreBM25F(c, doc({ title: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });

  it('scoring a job that is NOT in the corpus does not throw and yields finite score', () => {
    const c = buildCorpus([doc({ title: 'kafka' })], tok);
    const s = scoreBM25F(c, doc({ title: 'redis' }), ['redis'], tok, DEFAULT_BM25_PARAMS);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('field weight = 0 for one field zeroes that field across the corpus, others still score', () => {
    const c = buildCorpus([doc({ title: 'kafka', description: 'kafka' })], tok);
    const params: BM25Params = {
      ...DEFAULT_BM25_PARAMS,
      fieldWeights: { title: 0, description: 1, company: 0.5, location: 0.3 },
    };
    const s = scoreBM25F(c, doc({ title: 'kafka', description: 'kafka' }), ['kafka'], tok, params);
    expect(s).toBeGreaterThan(0);
    expect(Number.isFinite(s)).toBe(true);
  });

  it('ALL field weights = 0 yields total score = 0', () => {
    const c = buildCorpus([doc({ title: 'kafka', description: 'kafka redis' })], tok);
    const params: BM25Params = {
      ...DEFAULT_BM25_PARAMS,
      fieldWeights: { title: 0, description: 0, company: 0, location: 0 },
    };
    const s = scoreBM25F(c, doc({ title: 'kafka', description: 'kafka redis' }), ['kafka', 'redis'], tok, params);
    expect(s).toBe(0);
  });

  it('queryTerms = [] returns 0', () => {
    const c = buildCorpus([doc({ description: 'kafka' })], tok);
    const s = scoreBM25F(c, doc({ description: 'kafka' }), [], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
  });

  it('query term in corpus but with tf=0 in this doc contributes 0 (no NaN)', () => {
    const c = buildCorpus([doc({ title: 'kafka' }), doc({ title: 'redis' })], tok);
    const s = scoreBM25F(c, doc({ title: 'kafka' }), ['redis'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
    expect(Number.isNaN(s)).toBe(false);
  });

  it('scoring the same job twice produces identical results (deterministic, no internal mutation)', () => {
    const c = buildCorpus([doc({ title: 'kafka' }), doc({ title: 'redis' })], tok);
    const a = scoreBM25F(c, doc({ title: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const b = scoreBM25F(c, doc({ title: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(a).toBe(b);
  });

  it('pathological: title="kafka" repeated 1000× score saturates, not linear', () => {
    const repeated = Array(1000).fill('kafka').join(' ');
    const c = buildCorpus([doc({ title: repeated })], tok);
    const s = scoreBM25F(c, doc({ title: repeated }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const { k1, minIdfFloor } = DEFAULT_BM25_PARAMS;
    const ceiling = minIdfFloor * (k1 + 1);
    expect(s).toBeLessThanOrEqual(ceiling + 1e-9);
    expect(Number.isFinite(s)).toBe(true);
  });

  it('job with title + description BOTH empty scores 0 against any query', () => {
    const c = buildCorpus([doc({ title: 'kafka' })], tok);
    const s = scoreBM25F(c, doc({}), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
  });

  it('large corpus of 1000 docs builds in under 500ms', () => {
    const big: BM25Doc[] = [];
    for (let i = 0; i < 1000; i += 1) {
      big.push(doc({ title: `title ${i}`, description: `kafka redis ${i % 50}` }));
    }
    const t0 = performance.now();
    const c = buildCorpus(big, tok);
    const t1 = performance.now();
    expect(c.N).toBe(1000);
    expect(t1 - t0).toBeLessThan(500);
  });

  it('buildCorpus uses a Set per doc so multiple occurrences of a term still count df=1 for that doc', () => {
    const c = buildCorpus(
      [doc({ title: 'kafka kafka kafka kafka', description: 'kafka' })],
      tok,
    );
    expect(c.df.get('kafka')).toBe(1);
    expect(c.N).toBe(1);
  });
});
