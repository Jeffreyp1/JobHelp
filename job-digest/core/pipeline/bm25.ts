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

export interface Corpus {
  readonly avgFieldLengths: Record<FieldName, number>;
  readonly df: ReadonlyMap<string, number>;
  readonly N: number;
}

export interface BM25Doc {
  readonly title: string;
  readonly description: string;
  readonly company: string;
  readonly location: string;
}

type Tokenizer = (s: string) => readonly string[];

function uniqueTerms(tokens: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) s.add(t);
  return s;
}

function termFreq(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

/**
 * Build a BM25F corpus from a pool of job documents.
 *
 * Records:
 * - `avgFieldLengths` — mean token count per field across the pool, used for
 *   length normalization.
 * - `df` — document frequency per term (collapsed across all fields).
 *   A term occurring in any field of a doc counts once toward that doc's df.
 * - `N` — total docs in pool.
 *
 * Empty corpus is valid; scoring against it yields 0.
 */
export function buildCorpus(
  jobs: readonly BM25Doc[],
  tokenize: Tokenizer,
): Corpus {
  const N = jobs.length;
  const sums: Record<FieldName, number> = { title: 0, description: 0, company: 0, location: 0 };
  const df = new Map<string, number>();

  for (const job of jobs) {
    const docTerms = new Set<string>();
    for (const field of FIELDS) {
      const toks = tokenize(job[field]);
      sums[field] += toks.length;
      for (const t of toks) docTerms.add(t);
    }
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

  return { avgFieldLengths, df, N };
}

function idf(N: number, df: number, floor: number): number {
  if (N === 0) return floor;
  const raw = Math.log((N - df + 0.5) / (df + 0.5));
  if (raw < 0 || !Number.isFinite(raw)) return floor;
  return Math.max(floor, raw);
}

/**
 * Score a single doc against a query under BM25F (field-weighted BM25).
 *
 * For each query term q:
 *   weightedTf = sum_f [ (tf_f / (1 - b + b * len_f/avgLen_f)) * fieldWeight_f ]
 *   score += idf(q) * weightedTf * (k1 + 1) / (weightedTf + k1)
 *
 * IDF is applied once per query term (not once per field per term).
 * Empty queries score 0. Empty fields contribute 0 (length 0).
 * Terms not present in the corpus (df=0) still score via the IDF floor.
 */
export function scoreBM25F(
  corpus: Corpus,
  job: BM25Doc,
  queryTerms: readonly string[],
  tokenize: Tokenizer,
  params: BM25Params,
): number {
  if (queryTerms.length === 0) return 0;
  if (corpus.N === 0) return 0;

  const titleToks = tokenize(job.title);
  const descToks = tokenize(job.description);
  const companyToks = tokenize(job.company);
  const locationToks = tokenize(job.location);
  const fieldTokens: Record<FieldName, Map<string, number>> = {
    title: termFreq(titleToks),
    description: termFreq(descToks),
    company: termFreq(companyToks),
    location: termFreq(locationToks),
  };
  const fieldLens: Record<FieldName, number> = {
    title: titleToks.length,
    description: descToks.length,
    company: companyToks.length,
    location: locationToks.length,
  };

  const querySet = uniqueTerms(queryTerms);
  let total = 0;
  const { k1, b, fieldWeights, minIdfFloor } = params;

  for (const q of querySet) {
    let weightedTf = 0;
    for (const f of FIELDS) {
      const tf = fieldTokens[f].get(q) ?? 0;
      if (tf === 0) continue;
      const avgLen = corpus.avgFieldLengths[f];
      const lenNorm = avgLen === 0 ? 1 : 1 - b + b * (fieldLens[f] / avgLen);
      weightedTf += (tf / lenNorm) * fieldWeights[f];
    }
    if (weightedTf === 0) continue;
    const idfQ = idf(corpus.N, corpus.df.get(q) ?? 0, minIdfFloor);
    total += idfQ * (weightedTf * (k1 + 1)) / (weightedTf + k1);
  }
  return total;
}
