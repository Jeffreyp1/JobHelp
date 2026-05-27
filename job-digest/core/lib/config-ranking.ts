import type {
  BM25ConfigBlock,
  BM25FieldName,
  FusionConfig,
  MaxAgeConfig,
  RecencyConfig,
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

export const DEFAULT_FUSION: FusionConfig = {
  enabled: false,
  k: 60,
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
  return { enabled, k };
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
