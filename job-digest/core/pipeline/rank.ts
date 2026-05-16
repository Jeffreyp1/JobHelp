import type { JobDigestConfig, NormalizedJob, RankedJob, ScoreBreakdown } from '../types/index.js';
import { log } from '../lib/log.js';
import { escapeRegExp } from '../lib/regexp.js';
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

const DEFAULT_RECENCY_FLOOR = 0.5;
const DEFAULT_RECENCY_WINDOW_DAYS = 30;
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

function recencyBoostScore(postedAt: string | undefined): number {
  if (postedAt === undefined || postedAt === '') return 1.0;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return 1.0;
  const daysOld = (Date.now() - ts) / MS_PER_DAY;
  if (daysOld <= 0) return 1.0;
  return Math.max(DEFAULT_RECENCY_FLOOR, 1 - daysOld / DEFAULT_RECENCY_WINDOW_DAYS);
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

/**
 * Build the once-per-pipeline-run state used by `rank`: alias map, canonical
 * tokenizer, corpus, canonicalized query terms, resolved BM25 params. Callable
 * from `runPipeline` so the corpus is computed once across all jobs.
 */
export function buildRankPrecomputed(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): RankPrecomputed {
  const aliases = getAliasMap();
  const tokenize = makeCanonicalTokenizer(aliases);
  const params = resolveBM25Params(config);
  const corpus = buildCorpus(
    jobs.map((j) => ({
      title: j.title,
      description: j.description,
      company: j.company,
      location: j.location,
    })),
    tokenize,
  );
  const queryTerms = buildQueryTerms(config.profile.skills, aliases);
  return { aliases, tokenize, corpus, queryTerms, params };
}

/**
 * Rank jobs by BM25F × recency boost. Pure deterministic — no LLM calls.
 *
 * BM25F (field-weighted BM25) scores each job against the canonicalized skill
 * query: title hits weighted ~3x description hits; TF saturation prevents
 * spammy repetition from winning; IDF down-weights common terms; per-field
 * length normalization prevents long descriptions from accumulating accidental
 * hits. The corpus + alias map are built once per `rank()` call and shared
 * across all jobs in the pool.
 *
 * Design B: ranking.useLlmFitScore is silently ignored. breakdown.llmFitScore
 * and llmRationale are always undefined.
 *
 * Back-compat: ScoreBreakdown still carries the legacy `keywordOverlap` field
 * for any consumer that read it, plus the new `bm25f` raw score.
 */
export async function rank(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  precomputed?: RankPrecomputed,
): Promise<readonly RankedJob[]> {
  if (jobs.length === 0) return [];

  if (config.ranking.useLlmFitScore) {
    log('debug', 'rank.llm_fit_score_ignored', {});
  }

  const pc = precomputed ?? buildRankPrecomputed(jobs, config);

  const scored: RankedJob[] = jobs.map((job) => {
    const keywordOverlap = keywordOverlapScore(job, config.profile.skills);
    const recencyBoost = recencyBoostScore(job.postedAt);
    const bm25f = scoreBM25F(
      pc.corpus,
      {
        title: job.title,
        description: job.description,
        company: job.company,
        location: job.location,
      },
      pc.queryTerms,
      pc.tokenize,
      pc.params,
    );
    const score = bm25f * recencyBoost;
    const breakdown: ScoreBreakdown = { keywordOverlap, recencyBoost, bm25f };
    return { job, rank: 0, score, breakdown };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
