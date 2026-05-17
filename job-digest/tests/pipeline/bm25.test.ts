import { describe, it, expect } from 'vitest';
import {
  buildCorpus,
  scoreBM25F,
  DEFAULT_BM25_PARAMS,
  type BM25Params,
  type BM25Doc,
} from '../../core/pipeline/bm25.js';
import { tokenize } from '../../core/pipeline/tokenize.js';

const tok = (s: string): readonly string[] => tokenize(s);

function doc(over: Partial<BM25Doc> = {}): BM25Doc {
  return {
    title: '',
    description: '',
    company: '',
    location: '',
    ...over,
  };
}

describe('bm25 — buildCorpus', () => {
  it('empty corpus scores 0 with no NaN', () => {
    const corpus = buildCorpus([], tok);
    const s = scoreBM25F(corpus, doc({ title: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
    expect(Number.isNaN(s)).toBe(false);
  });

  it('records doc frequency per term and N', () => {
    const corpus = buildCorpus(
      [doc({ description: 'kafka redis' }), doc({ description: 'kafka' }), doc({ description: 'redis' })],
      tok,
    );
    expect(corpus.N).toBe(3);
    expect(corpus.df.get('kafka')).toBe(2);
    expect(corpus.df.get('redis')).toBe(2);
  });
});

describe('bm25 — scoreBM25F', () => {
  it('single-doc single-term IDF floor is active; score > 0', () => {
    const corpus = buildCorpus([doc({ title: 'kafka engineer' })], tok);
    const s = scoreBM25F(corpus, doc({ title: 'kafka engineer' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBeGreaterThan(0);
  });

  it('term in title weighted more than same term in description', () => {
    const jobs: readonly BM25Doc[] = [
      doc({ title: 'kafka engineer', description: 'pad pad pad pad pad' }),
      doc({ title: 'data engineer', description: 'kafka pad pad pad pad' }),
    ];
    const corpus = buildCorpus(jobs, tok);
    const sTitle = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const sDesc = scoreBM25F(corpus, jobs[1]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(sTitle).toBeGreaterThan(sDesc);
  });

  it('TF saturation: 10× same term in body is NOT 10× score', () => {
    const tenK = Array(10).fill('kafka').join(' ');
    const twoK = Array(2).fill('kafka').join(' ');
    const jobs = [doc({ description: tenK }), doc({ description: twoK })];
    const corpus = buildCorpus(jobs, tok);
    const s10 = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const s2 = scoreBM25F(corpus, jobs[1]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s10).toBeGreaterThan(s2);
    expect(s10 / s2).toBeLessThan(5);
  });

  it('length norm: same term in short desc > same term in long desc', () => {
    const shortDesc = 'kafka systems team backend';
    const longDesc = 'kafka ' + Array(500).fill('foo bar baz qux').join(' ');
    const jobs = [doc({ description: shortDesc }), doc({ description: longDesc })];
    const corpus = buildCorpus(jobs, tok);
    const sShort = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const sLong = scoreBM25F(corpus, jobs[1]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(sShort).toBeGreaterThan(sLong);
  });

  it('field weights are configurable via params arg', () => {
    const jobs = [doc({ title: 'kafka eng' })];
    const corpus = buildCorpus(jobs, tok);
    const heavy: BM25Params = {
      ...DEFAULT_BM25_PARAMS,
      fieldWeights: { title: 10, description: 1, company: 0.5, location: 0.3 },
    };
    const light: BM25Params = {
      ...DEFAULT_BM25_PARAMS,
      fieldWeights: { title: 1, description: 1, company: 0.5, location: 0.3 },
    };
    const sHeavy = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, heavy);
    const sLight = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, light);
    expect(sHeavy).toBeGreaterThan(sLight);
    expect(sHeavy / sLight).toBeGreaterThan(1.5);
  });

  it('missing field (empty string) treated as length 0 and contributes 0', () => {
    const jobs = [doc({ title: 'kafka' }), doc({ description: 'kafka' })];
    const corpus = buildCorpus(jobs, tok);
    const onlyTitle = doc({ title: 'kafka' });
    const s = scoreBM25F(corpus, onlyTitle, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBeGreaterThan(0);
    expect(Number.isFinite(s)).toBe(true);
  });

  it('multi-term query scores sum across terms', () => {
    const jobs = [doc({ description: 'kafka redis golang' })];
    const corpus = buildCorpus(jobs, tok);
    const sBoth = scoreBM25F(corpus, jobs[0]!, ['kafka', 'redis'], tok, DEFAULT_BM25_PARAMS);
    const sKafka = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    const sRedis = scoreBM25F(corpus, jobs[0]!, ['redis'], tok, DEFAULT_BM25_PARAMS);
    expect(sBoth).toBeCloseTo(sKafka + sRedis, 5);
  });

  it('term not in pool contributes 0 even with IDF floor (no field tf)', () => {
    const jobs = [doc({ description: 'redis only' })];
    const corpus = buildCorpus(jobs, tok);
    const s = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
  });

  it('IDF floor: very common term (df ≈ N) still scores > 0', () => {
    const jobs = Array.from({ length: 30 }, () => doc({ description: 'engineer' }));
    const corpus = buildCorpus(jobs, tok);
    const target = doc({ title: 'engineer engineer', description: 'engineer' });
    const s = scoreBM25F(corpus, target, ['engineer'], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBeGreaterThan(0);
  });

  it('empty query returns 0', () => {
    const corpus = buildCorpus([doc({ description: 'kafka' })], tok);
    const s = scoreBM25F(corpus, doc({ description: 'kafka' }), [], tok, DEFAULT_BM25_PARAMS);
    expect(s).toBe(0);
  });

  it('IDF applied once per query term: multi-field match score stays within saturation ceiling', () => {
    // Corpus: two docs, "kafka" appears in both => df=2, N=2, idf=floor=0.1.
    // Doc A has "kafka" in both title AND description.
    // Saturation ceiling per term = idf * (k1 + 1) regardless of how many fields match.
    // The broken formula applies saturation PER FIELD then sums, exceeding the ceiling.
    // The correct BM25F formula accumulates weighted TF across fields FIRST, then applies
    // saturation ONCE, so the result cannot exceed idf * (k1 + 1).
    const jobs: readonly BM25Doc[] = [
      doc({ title: 'kafka', description: 'kafka' }),
      doc({ title: 'kafka', description: '' }),
    ];
    const corpus = buildCorpus(jobs, tok);
    const { k1, minIdfFloor } = DEFAULT_BM25_PARAMS;
    const ceiling = minIdfFloor * (k1 + 1);
    const scoreA = scoreBM25F(corpus, jobs[0]!, ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(scoreA).toBeLessThanOrEqual(ceiling);
  });

  it('idf returns the floor when df exceeds N (mismatched-corpus defense)', () => {
    const real = buildCorpus([doc({ description: 'kafka' }), doc({ description: 'kafka' })], tok);
    const stale: typeof real = {
      avgFieldLengths: real.avgFieldLengths,
      df: new Map([['kafka', 5]]),
      N: 2,
    };
    const s = scoreBM25F(stale, doc({ description: 'kafka' }), ['kafka'], tok, DEFAULT_BM25_PARAMS);
    expect(Number.isFinite(s)).toBe(true);
    expect(Number.isNaN(s)).toBe(false);
    expect(s).toBeGreaterThan(0);
  });
});
