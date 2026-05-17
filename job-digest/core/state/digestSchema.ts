import type {
  NormalizedJob,
  RankedJob,
  RemoteMode,
  ScoreBreakdown,
  SourceError,
  SourceErrorType,
  SourceRunResult,
} from '../types/index.js';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isSourceErrorType(v: string): v is SourceErrorType {
  return v === 'network' || v === 'auth' || v === 'rate_limit' || v === 'parse' || v === 'unknown';
}

export function isRemoteMode(v: string): v is RemoteMode {
  return v === 'remote' || v === 'hybrid' || v === 'onsite' || v === 'unknown';
}

export function parseSourceError(raw: unknown): SourceError | null {
  if (!isPlainObject(raw)) return null;
  const type = raw['type'];
  const message = raw['message'];
  if (typeof type !== 'string' || typeof message !== 'string') return null;
  if (!isSourceErrorType(type)) return null;
  return { type, message };
}

export function parseSourceRunResult(raw: unknown): SourceRunResult | null {
  if (!isPlainObject(raw)) return null;
  const source = raw['source'];
  const jobCount = raw['jobCount'];
  const durationMs = raw['durationMs'];
  if (typeof source !== 'string') return null;
  if (typeof jobCount !== 'number') return null;
  if (typeof durationMs !== 'number') return null;
  const errorRaw = raw['error'];
  if (errorRaw === undefined) return { source, jobCount, durationMs };
  const parsedError = parseSourceError(errorRaw);
  if (parsedError === null) return null;
  return { source, jobCount, durationMs, error: parsedError };
}

export function parseNormalizedJob(raw: unknown): NormalizedJob | null {
  if (!isPlainObject(raw)) return null;
  const id = raw['id'];
  const source = raw['source'];
  const url = raw['url'];
  const title = raw['title'];
  const company = raw['company'];
  const location = raw['location'];
  const remote = raw['remote'];
  const description = raw['description'];
  if (
    typeof id !== 'string' ||
    typeof source !== 'string' ||
    typeof url !== 'string' ||
    typeof title !== 'string' ||
    typeof company !== 'string' ||
    typeof location !== 'string' ||
    typeof description !== 'string'
  ) {
    return null;
  }
  if (typeof remote !== 'string' || !isRemoteMode(remote)) return null;
  const base = { id, source, url, title, company, location, remote, description };
  const optional: {
    salaryMin?: number;
    salaryMax?: number;
    salaryCurrency?: string;
    postedAt?: string;
    rawSourceData?: unknown;
  } = {};
  const salaryMin = raw['salaryMin'];
  if (salaryMin !== undefined) {
    if (typeof salaryMin !== 'number') return null;
    optional.salaryMin = salaryMin;
  }
  const salaryMax = raw['salaryMax'];
  if (salaryMax !== undefined) {
    if (typeof salaryMax !== 'number') return null;
    optional.salaryMax = salaryMax;
  }
  const salaryCurrency = raw['salaryCurrency'];
  if (salaryCurrency !== undefined) {
    if (typeof salaryCurrency !== 'string') return null;
    optional.salaryCurrency = salaryCurrency;
  }
  const postedAt = raw['postedAt'];
  if (postedAt !== undefined) {
    if (typeof postedAt !== 'string') return null;
    optional.postedAt = postedAt;
  }
  if (raw['rawSourceData'] !== undefined) optional.rawSourceData = raw['rawSourceData'];
  return { ...base, ...optional };
}

export function parseScoreBreakdown(raw: unknown): ScoreBreakdown | null {
  if (!isPlainObject(raw)) return null;
  const keywordOverlap = raw['keywordOverlap'];
  const recencyBoost = raw['recencyBoost'];
  if (typeof keywordOverlap !== 'number' || typeof recencyBoost !== 'number') return null;
  const rawBm25f = raw['bm25f'];
  const bm25f = typeof rawBm25f === 'number' ? rawBm25f : 0;
  const rawSourceTrust = raw['sourceTrust'];
  const sourceTrust = typeof rawSourceTrust === 'number' ? rawSourceTrust : 1.0;
  const rawRrf = raw['rrf'];
  const rrf = typeof rawRrf === 'number' && Number.isFinite(rawRrf) ? rawRrf : undefined;
  const llmFitScore = raw['llmFitScore'];
  if (llmFitScore === undefined) return { keywordOverlap, recencyBoost, bm25f, sourceTrust, ...(rrf !== undefined && { rrf }) };
  if (typeof llmFitScore !== 'number') return null;
  return { keywordOverlap, recencyBoost, bm25f, sourceTrust, ...(rrf !== undefined && { rrf }), llmFitScore };
}

export function parseRankedJob(raw: unknown): RankedJob | null {
  if (!isPlainObject(raw)) return null;
  const job = parseNormalizedJob(raw['job']);
  if (job === null) return null;
  const rank = raw['rank'];
  const score = raw['score'];
  if (typeof rank !== 'number' || typeof score !== 'number') return null;
  const breakdown = parseScoreBreakdown(raw['breakdown']);
  if (breakdown === null) return null;
  const llmRationale = raw['llmRationale'];
  if (llmRationale === undefined) return { job, rank, score, breakdown };
  if (typeof llmRationale !== 'string') return null;
  return { job, rank, score, breakdown, llmRationale };
}
