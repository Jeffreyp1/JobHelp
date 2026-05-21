import type {
  JobDigestConfig,
  NormalizedJob,
  RankedJob,
  RecencyConfig,
  ScoreBreakdown,
  SourceTrustConfig,
} from '../types/index.js';
import { log } from '../lib/log.js';
import { escapeRegExp } from '../lib/regexp.js';
import { DEFAULT_FUSION, DEFAULT_RECENCY, DEFAULT_SOURCE_TRUST } from '../lib/config-ranking.js';
import {
  buildCorpus,
  scoreBM25F,
  DEFAULT_BM25_PARAMS,
  type BM25Params,
  type Corpus,
  type FieldName,
} from './bm25.js';
import { tokenize as defaultTokenize } from './tokenize.js';
import {
  getAliasMap,
  canonicalizeAll,
  type AliasMap,
} from './skill-aliases.js';
import {
  buildBm25Rank,
  buildRecencyRank,
  buildRoleFitRank,
  computeRrf,
} from './rrf.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function keywordOverlapScore(job: NormalizedJob, skills: readonly string[]): number {
  if (skills.length === 0) return 0;
  const haystack = (job.title + ' ' + job.description).toLowerCase();
  let hits = 0;
  for (const skill of skills) {
    const trimmed = skill.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    const re = new RegExp('\\b' + escapeRegExp(trimmed) + '\\b');
    if (re.test(haystack)) hits += 1;
  }
  const raw = hits / skills.length;
  return Math.min(1, Math.max(0, raw));
}

export function computeRecencyMultiplier(
  job: NormalizedJob,
  cfg: RecencyConfig,
  now: Date,
): number {
  if (cfg.enabled === false) return 1.0;
  const halfLife = cfg.halfLifeDays;
  if (!Number.isFinite(halfLife) || halfLife <= 0) {
    log('warn', 'rank.recency.invalid_half_life', { halfLifeDays: halfLife });
    return 1.0;
  }
  const postedAt = job.postedAt;
  // Empty string treated as absent: some adapters emit '' as a sentinel.
  if (postedAt === undefined || postedAt === '') return 1.0;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    log('warn', 'rank.recency.invalid_now', { id: job.id, source: job.source });
    return 1.0;
  }
  const ts = Date.parse(postedAt);
  if (!Number.isFinite(ts)) {
    log('warn', 'rank.recency.unparseable_postedAt', {
      id: job.id,
      source: job.source,
      postedAt,
    });
    return 1.0;
  }
  const ageDays = (nowMs - ts) / MS_PER_DAY;
  if (ageDays <= 0) return 1.0;
  const m = Math.pow(2, -ageDays / halfLife);
  if (!Number.isFinite(m)) return 1.0;
  return Math.min(1, Math.max(0, m));
}

export function computeSourceTrustMultiplier(
  job: NormalizedJob,
  cfg: SourceTrustConfig,
): number {
  if (cfg.enabled === false) return 1.0;
  const raw = cfg.weights[job.source];
  if (raw === undefined) return 1.0;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    log('warn', 'rank.source_trust.invalid_weight', { source: job.source, weight: raw });
    return 1.0;
  }
  return raw;
}

function resolveBM25Params(config: JobDigestConfig): BM25Params {
  const cfg = config.ranking.bm25;
  if (cfg === undefined) return DEFAULT_BM25_PARAMS;
  const fw: Record<FieldName, number> = { ...DEFAULT_BM25_PARAMS.fieldWeights };
  if (cfg.fieldWeights !== undefined) {
    for (const f of ['title', 'description', 'company', 'location'] as const) {
      const v = cfg.fieldWeights[f];
      if (typeof v === 'number') fw[f] = v;
    }
  }
  return {
    k1: cfg.k1 ?? DEFAULT_BM25_PARAMS.k1,
    b: cfg.b ?? DEFAULT_BM25_PARAMS.b,
    fieldWeights: fw,
    minIdfFloor: cfg.minIdfFloor ?? DEFAULT_BM25_PARAMS.minIdfFloor,
  };
}

function buildQueryTerms(skills: readonly string[], aliases: AliasMap): readonly string[] {
  const rawTokens: string[] = [];
  for (const skill of skills) {
    const toks = defaultTokenize(skill, aliases.multiWordPhrases);
    for (const t of toks) rawTokens.push(t);
  }
  return canonicalizeAll(rawTokens, aliases);
}

function makeCanonicalTokenizer(aliases: AliasMap): (s: string) => readonly string[] {
  const phrases = aliases.multiWordPhrases;
  return (s: string): readonly string[] => {
    const toks = defaultTokenize(s, phrases);
    const out: string[] = [];
    for (const t of toks) {
      out.push(canonicalizeAll([t], aliases)[0] ?? t.toLowerCase());
    }
    return out;
  };
}

export interface RankPrecomputed {
  readonly aliases: AliasMap;
  readonly tokenize: (s: string) => readonly string[];
  readonly corpus: Corpus;
  readonly queryTerms: readonly string[];
  readonly params: BM25Params;
}

// Once-per-pipeline-run state shared across all jobs: alias map, tokenizer, corpus, query terms, params.
export function buildRankPrecomputed(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): RankPrecomputed {
  const aliases = getAliasMap();
  const tokenize = makeCanonicalTokenizer(aliases);
  const params = resolveBM25Params(config);
  const queryTerms = buildQueryTerms(config.profile.skills, aliases);
  const corpus = buildCorpus(
    jobs.map((j) => ({
      title: j.title,
      description: j.description,
      company: j.company,
      location: j.location,
    })),
    tokenize,
    queryTerms,
  );
  return { aliases, tokenize, corpus, queryTerms, params };
}

// BM25F × recency half-life × source-trust, optionally fused with RRF. Pure deterministic, no LLM.
export async function rank(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  precomputed?: RankPrecomputed,
  now: Date = new Date(),
): Promise<readonly RankedJob[]> {
  if (jobs.length === 0) return [];

  const pc = precomputed ?? buildRankPrecomputed(jobs, config);
  const recencyCfg = config.ranking.recency ?? DEFAULT_RECENCY;
  const sourceTrustCfg = config.ranking.sourceTrust ?? DEFAULT_SOURCE_TRUST;
  const fusionCfg = config.ranking.fusion ?? DEFAULT_FUSION;

  const bm25Scores = new Map<string, number>();
  const baseScored = jobs.map((job, i) => {
    const keywordOverlap = keywordOverlapScore(job, config.profile.skills);
    const recencyBoost = computeRecencyMultiplier(job, recencyCfg, now);
    const sourceTrust = computeSourceTrustMultiplier(job, sourceTrustCfg);
    const bm25f = scoreBM25F(pc.corpus, i, pc.queryTerms, pc.params);
    bm25Scores.set(job.id, bm25f);
    const productScore = bm25f * recencyBoost * sourceTrust;
    const breakdown: ScoreBreakdown = { keywordOverlap, recencyBoost, bm25f, sourceTrust };
    return { job, productScore, breakdown };
  });

  let scored: RankedJob[];
  if (fusionCfg.enabled) {
    const lists = [
      buildBm25Rank(jobs, bm25Scores),
      buildRecencyRank(jobs),
    ];
    if (config.profile.roleFamily.length > 0) {
      lists.push(buildRoleFitRank(jobs, config.profile.roleFamily));
    }
    const rrfScores = computeRrf(lists, (j: NormalizedJob) => j.id, fusionCfg.k);
    scored = baseScored.map(({ job, breakdown }) => {
      const rrfMaybe = rrfScores.get(job.id);
      const merged: ScoreBreakdown = rrfMaybe !== undefined
        ? { ...breakdown, rrf: rrfMaybe }
        : breakdown;
      return { job, rank: 0, score: rrfMaybe ?? 0, breakdown: merged };
    });
  } else {
    scored = baseScored.map(({ job, productScore, breakdown }) => ({
      job,
      rank: 0,
      score: productScore,
      breakdown,
    }));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
