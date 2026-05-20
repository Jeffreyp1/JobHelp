import { log } from '../lib/log.js';

export type FieldName = 'title' | 'description' | 'company' | 'location';

export const FIELDS: readonly FieldName[] = ['title', 'description', 'company', 'location'];

export interface BM25Params {
  readonly k1: number;
  readonly b: number;
  readonly fieldWeights: Record<FieldName, number>;
  readonly minIdfFloor: number;
}

export const DEFAULT_BM25_PARAMS: BM25Params = {
  k1: 1.2,
  b: 0.75,
  fieldWeights: { title: 3.0, description: 1.0, company: 0.5, location: 0.3 },
  minIdfFloor: 0.1,
};

function sanitizeParams(p: BM25Params): BM25Params {
  let { k1, b, minIdfFloor } = p;
  const warnings: Record<string, unknown> = {};
  if (!Number.isFinite(k1) || k1 < 0) {
    warnings['k1'] = k1;
    k1 = DEFAULT_BM25_PARAMS.k1;
  }
  if (!Number.isFinite(b) || b < 0 || b > 1) {
    warnings['b'] = b;
    b = DEFAULT_BM25_PARAMS.b;
  }
  // minIdfFloor < 0 is intentionally permitted: Okapi BM25 allows negative idf for >50%-corpus terms as a soft penalty.
  if (!Number.isFinite(minIdfFloor)) {
    warnings['minIdfFloor'] = minIdfFloor;
    minIdfFloor = DEFAULT_BM25_PARAMS.minIdfFloor;
  }
  if (Object.keys(warnings).length > 0) {
    log('warn', 'bm25.invalid_param_clamped_to_default', warnings);
    return { ...p, k1, b, minIdfFloor };
  }
  return p;
}

// Per-doc tokens cached at corpus-build time so scoring never re-tokenizes.
export interface DocTokens {
  readonly fieldTokens: Record<FieldName, ReadonlyMap<string, number>>;
  readonly fieldLens: Record<FieldName, number>;
}

export interface Corpus {
  readonly avgFieldLengths: Record<FieldName, number>;
  readonly df: ReadonlyMap<string, number>;
  readonly N: number;
  readonly docs: readonly DocTokens[];
}

export interface BM25Doc {
  readonly title: string;
  readonly description: string;
  readonly company: string;
  readonly location: string;
}

type Tokenizer = (s: string) => readonly string[];

// Build BM25F corpus: per-field avg lengths, doc-frequency per term, N, and
// per-doc token-frequency maps cached so scoring reuses them (no re-tokenize).
// queryTerms scopes the per-doc cache: scoring only looks up query terms, so
// caching the full vocabulary per doc is wasteful (OOM on large pools). When
// omitted, every term is cached (fine for small corpora / tests).
export function buildCorpus(
  jobs: readonly BM25Doc[],
  tokenize: Tokenizer,
  queryTerms?: readonly string[],
): Corpus {
  const N = jobs.length;
  const sums: Record<FieldName, number> = { title: 0, description: 0, company: 0, location: 0 };
  const df = new Map<string, number>();
  const docs: DocTokens[] = [];
  const querySet = queryTerms === undefined ? undefined : new Set<string>(queryTerms);

  for (const job of jobs) {
    const fieldTokens: Record<FieldName, Map<string, number>> = {
      title: new Map(), description: new Map(), company: new Map(), location: new Map(),
    };
    const fieldLens: Record<FieldName, number> = { title: 0, description: 0, company: 0, location: 0 };
    const docTerms = new Set<string>();
    for (const field of FIELDS) {
      const toks = tokenize(job[field]);
      sums[field] += toks.length;
      fieldLens[field] = toks.length;
      const cache = fieldTokens[field];
      for (const t of toks) {
        docTerms.add(t);
        if (querySet === undefined || querySet.has(t)) {
          cache.set(t, (cache.get(t) ?? 0) + 1);
        }
      }
    }
    docs.push({ fieldTokens, fieldLens });
    for (const t of docTerms) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const avgFieldLengths: Record<FieldName, number> = {
    title: N === 0 ? 0 : sums.title / N,
    description: N === 0 ? 0 : sums.description / N,
    company: N === 0 ? 0 : sums.company / N,
    location: N === 0 ? 0 : sums.location / N,
  };

  return { avgFieldLengths, df, N, docs };
}

function idf(N: number, df: number, floor: number): number {
  if (N === 0) return floor;
  const raw = Math.log((N - df + 0.5) / (df + 0.5));
  if (raw < 0 || !Number.isFinite(raw)) return floor;
  return Math.max(floor, raw);
}

// BM25F score for corpus.docs[docIndex]: per query term q, weightedTf =
// Σ_f (tf_f / lenNorm_f) * fieldWeight_f; score += idf(q) * weightedTf * (k1+1) / (weightedTf + k1).
export function scoreBM25F(
  corpus: Corpus,
  docIndex: number,
  queryTerms: readonly string[],
  params: BM25Params,
): number {
  if (queryTerms.length === 0) return 0;
  if (corpus.N === 0) return 0;
  const doc = corpus.docs[docIndex];
  if (doc === undefined) return 0;

  const querySet = new Set<string>(queryTerms);
  let total = 0;
  const { k1, b, fieldWeights, minIdfFloor } = sanitizeParams(params);

  for (const q of querySet) {
    let weightedTf = 0;
    for (const f of FIELDS) {
      const tf = doc.fieldTokens[f].get(q) ?? 0;
      if (tf === 0) continue;
      const avgLen = corpus.avgFieldLengths[f];
      const lenNorm = avgLen === 0 ? 1 : 1 - b + b * (doc.fieldLens[f] / avgLen);
      weightedTf += (tf / lenNorm) * fieldWeights[f];
    }
    if (weightedTf === 0) continue;
    const idfQ = idf(corpus.N, corpus.df.get(q) ?? 0, minIdfFloor);
    total += idfQ * (weightedTf * (k1 + 1)) / (weightedTf + k1);
  }
  return total;
}
