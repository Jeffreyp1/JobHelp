import type {
  BlendWeights,
  BM25ConfigBlock,
  BM25FieldName,
  FusionConfig,
  HistoryConfig,
  MaxAgeConfig,
  RecencyConfig,
  RerankConfig,
  SourceTrustConfig,
} from '../types/config.js';
import { DEFAULT_BM25_PARAMS } from '../pipeline/bm25.js';

export { DEFAULT_BM25_PARAMS };

export const DEFAULT_RECENCY: RecencyConfig = {
  enabled: true,
  halfLifeDays: 21,
};

export const DEFAULT_MAX_AGE: MaxAgeConfig = {
  enabled: true,
  days: 30,
  requireDate: false,
};

export const DEFAULT_SOURCE_TRUST: SourceTrustConfig = {
  enabled: false,
  weights: {
    greenhouse: 1.0,
    lever: 1.0,
    adzuna: 0.7,
    remotive: 0.85,
    remoteok: 0.75,
  },
};

export const DEFAULT_BLEND_WEIGHTS: BlendWeights = { bm25: 0.5, semantic: 0.5 };

export const DEFAULT_FUSION: FusionConfig = {
  enabled: false,
  k: 60,
  mode: 'rrf',
  weights: DEFAULT_BLEND_WEIGHTS,
  seniorityPenalty: true,
};

export const DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 2000;

export const DEFAULT_RERANK_TOP_K = 50;

export const DEFAULT_RERANK: RerankConfig = {
  enabled: false,
  topK: DEFAULT_RERANK_TOP_K,
};

export const DEFAULT_HISTORY_BOOST_CAP = 1.15;

export const DEFAULT_HISTORY: HistoryConfig = {
  enabled: false,
  boostCap: DEFAULT_HISTORY_BOOST_CAP,
};

const BM25_FIELDS: readonly BM25FieldName[] = ['title', 'description', 'company', 'location'];

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireRecord(v: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`expected object at field ${field}`);
  return v;
}

function requireNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) fail(`expected number at field ${field}`);
  return v;
}

export function validateBM25(raw: unknown): BM25ConfigBlock {
  const d = DEFAULT_BM25_PARAMS;
  if (raw === undefined) {
    return { k1: d.k1, b: d.b, fieldWeights: { ...d.fieldWeights }, minIdfFloor: d.minIdfFloor };
  }
  const obj = requireRecord(raw, 'ranking.bm25');
  const fw: Partial<Record<BM25FieldName, number>> = { ...d.fieldWeights };
  const rawW = obj['fieldWeights'];
  if (rawW !== undefined) {
    const w = requireRecord(rawW, 'ranking.bm25.fieldWeights');
    for (const f of BM25_FIELDS) {
      if (w[f] !== undefined) fw[f] = requireNumber(w[f], `ranking.bm25.fieldWeights.${f}`);
    }
  }
  return {
    k1: obj['k1'] !== undefined ? requireNumber(obj['k1'], 'ranking.bm25.k1') : d.k1,
    b: obj['b'] !== undefined ? requireNumber(obj['b'], 'ranking.bm25.b') : d.b,
    fieldWeights: fw,
    minIdfFloor:
      obj['minIdfFloor'] !== undefined
        ? requireNumber(obj['minIdfFloor'], 'ranking.bm25.minIdfFloor')
        : d.minIdfFloor,
  };
}

function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

export function validateRecency(raw: unknown): RecencyConfig {
  if (!isPlainObject(raw)) return DEFAULT_RECENCY;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_RECENCY.enabled;
  const halfLifeDays = isFinitePositive(raw['halfLifeDays'])
    ? raw['halfLifeDays']
    : DEFAULT_RECENCY.halfLifeDays;
  return { enabled, halfLifeDays };
}

export function validateMaxAge(raw: unknown): MaxAgeConfig {
  if (!isPlainObject(raw)) return DEFAULT_MAX_AGE;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_MAX_AGE.enabled;
  const days = isFinitePositive(raw['days']) ? raw['days'] : DEFAULT_MAX_AGE.days;
  const requireDate =
    typeof raw['requireDate'] === 'boolean' ? raw['requireDate'] : DEFAULT_MAX_AGE.requireDate;
  return { enabled, days, requireDate };
}

export function validateFusion(raw: unknown): FusionConfig {
  if (!isPlainObject(raw)) return DEFAULT_FUSION;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_FUSION.enabled;
  const k = isFinitePositive(raw['k']) ? raw['k'] : DEFAULT_FUSION.k;
  const mode = raw['mode'] === 'blend' ? 'blend' : 'rrf';
  let weights: BlendWeights = DEFAULT_BLEND_WEIGHTS;
  const rawWeights = raw['weights'];
  if (isPlainObject(rawWeights)) {
    weights = {
      bm25: isFiniteNonNegative(rawWeights['bm25'])
        ? rawWeights['bm25']
        : DEFAULT_BLEND_WEIGHTS.bm25,
      semantic: isFiniteNonNegative(rawWeights['semantic'])
        ? rawWeights['semantic']
        : DEFAULT_BLEND_WEIGHTS.semantic,
    };
  }
  const seniorityPenalty =
    typeof raw['seniorityPenalty'] === 'boolean' ? raw['seniorityPenalty'] : true;
  return { enabled, k, mode, weights, seniorityPenalty };
}

export function validateRerank(raw: unknown): RerankConfig {
  if (!isPlainObject(raw)) return DEFAULT_RERANK;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_RERANK.enabled;
  const topK = isFinitePositive(raw['topK']) ? Math.floor(raw['topK']) : DEFAULT_RERANK_TOP_K;
  const rawModel = raw['model'];
  const model =
    typeof rawModel === 'string' && rawModel.trim().length > 0 ? rawModel : undefined;
  return { enabled, topK, ...(model !== undefined ? { model } : {}) };
}

export function validateHistory(raw: unknown): HistoryConfig {
  if (!isPlainObject(raw)) return DEFAULT_HISTORY;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_HISTORY.enabled;
  const boostCap =
    isFinitePositive(raw['boostCap']) && raw['boostCap'] >= 1
      ? raw['boostCap']
      : DEFAULT_HISTORY_BOOST_CAP;
  return { enabled, boostCap };
}

export function validateSourceTrust(raw: unknown): SourceTrustConfig {
  if (!isPlainObject(raw)) return DEFAULT_SOURCE_TRUST;
  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_SOURCE_TRUST.enabled;
  const merged: Record<string, number> = { ...DEFAULT_SOURCE_TRUST.weights };
  const rawWeights = raw['weights'];
  if (isPlainObject(rawWeights)) {
    for (const [key, value] of Object.entries(rawWeights)) {
      if (isFiniteNonNegative(value)) {
        merged[key] = value;
      }
    }
  }
  return { enabled, weights: merged };
}
