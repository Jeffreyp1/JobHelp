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
import {
  DEFAULT_BLEND_WEIGHTS,
  DEFAULT_FUSION,
  DEFAULT_RECENCY,
  DEFAULT_SOURCE_TRUST,
} from '../lib/config-ranking.js';
import { scoreBM25F } from './bm25.js';
import { buildRankPrecomputed, type RankPrecomputed } from './rankQuery.js';
import {
  buildBm25Rank,
  buildLevelFitRank,
  buildRecencyRank,
  buildRoleFitRank,
  buildSemanticRank,
  computeRrf,
} from './rrf.js';
import type { Embedder } from './embed.js';
import { computeBlendScores, seniorityPenaltiesFor } from './blend.js';
import { computeSemanticSimilarities } from './semanticStage.js';
import { applyRerank, type Reranker } from './rerank.js';
import { historyBoostsFor } from './history.js';
import type { ApplicationEntry } from '../state/index.js';

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
  return Math.min(1, Math.max(0.5, m));
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

export { buildRankPrecomputed, type RankPrecomputed } from './rankQuery.js';

export interface RankDeps {
  readonly embedder?: Embedder;
  readonly reranker?: Reranker;
  readonly applications?: readonly ApplicationEntry[];
}

// BM25F × recency half-life × source-trust, optionally fused. Fusion is either RRF (rank-based, +recency/role-fit/semantic lists)
// or 'blend' (convex score-magnitude mix of normalized BM25 + semantic × seniority penalty). Pure deterministic, no LLM.
export async function rank(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  precomputed?: RankPrecomputed,
  now: Date = new Date(),
  deps?: RankDeps,
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
    const breakdown: ScoreBreakdown =
      sourceTrustCfg.enabled === false
        ? { keywordOverlap, recencyBoost, bm25f }
        : { keywordOverlap, recencyBoost, bm25f, sourceTrust };
    return { job, productScore, breakdown };
  });

  let scored: RankedJob[];
  if (fusionCfg.enabled) {
    const semanticById = await computeSemanticSimilarities(
      jobs,
      config,
      deps?.embedder,
      bm25Scores,
    );
    if ((fusionCfg.mode ?? 'rrf') === 'blend') {
      const weights = fusionCfg.weights ?? DEFAULT_BLEND_WEIGHTS;
      const blendById = computeBlendScores(jobs, bm25Scores, semanticById, {
        wBm25: weights.bm25,
        wSemantic: weights.semantic,
        seniorityPenalty: fusionCfg.seniorityPenalty ?? true,
        candidateLevel: config.profile.seniority,
      });
      scored = baseScored.map(({ job, breakdown }) => {
        const res = blendById.get(job.id);
        const semanticMaybe = semanticById?.get(job.id);
        const merged: ScoreBreakdown = {
          ...breakdown,
          ...(res !== undefined ? { blend: res.blend, seniorityPenalty: res.penalty } : {}),
          ...(semanticMaybe !== undefined ? { semantic: semanticMaybe } : {}),
        };
        return { job, rank: 0, score: res?.blend ?? 0, breakdown: merged };
      });
    } else {
      const lists = [buildBm25Rank(jobs, bm25Scores), buildRecencyRank(jobs)];
      if (pc.coreQueryTerms.length > 0) {
        const coreScores = new Map<string, number>();
        jobs.forEach((job, i) =>
          coreScores.set(job.id, scoreBM25F(pc.corpus, i, pc.coreQueryTerms, pc.params)),
        );
        lists.push(buildBm25Rank(jobs, coreScores));
      }
      if (config.profile.roleFamily.length > 0) {
        lists.push(buildRoleFitRank(jobs, config.profile.roleFamily));
      }
      if (fusionCfg.seniorityPenalty ?? true) {
        lists.push(buildLevelFitRank(jobs, config.profile.seniority));
      }
      if (semanticById !== undefined) {
        lists.push(buildSemanticRank(jobs, semanticById));
      }
      const rrfScores = computeRrf(lists, (j: NormalizedJob) => j.id, fusionCfg.k);
      const penalties =
        (fusionCfg.seniorityPenalty ?? true)
          ? seniorityPenaltiesFor(jobs, config.profile.seniority)
          : undefined;
      scored = baseScored.map(({ job, breakdown }) => {
        const rrfMaybe = rrfScores.get(job.id);
        const semanticMaybe = semanticById?.get(job.id);
        const penalty = penalties?.get(job.id);
        const merged: ScoreBreakdown = {
          ...breakdown,
          ...(rrfMaybe !== undefined ? { rrf: rrfMaybe } : {}),
          ...(semanticMaybe !== undefined ? { semantic: semanticMaybe } : {}),
          ...(penalty !== undefined ? { seniorityPenalty: penalty } : {}),
        };
        return { job, rank: 0, score: (rrfMaybe ?? 0) * (penalty ?? 1), breakdown: merged };
      });
    }
  } else {
    if (config.ranking.semantic?.enabled === true) {
      log('warn', 'rank.semantic.requires_fusion', {});
    }
    scored = baseScored.map(({ job, productScore, breakdown }) => ({
      job,
      rank: 0,
      score: productScore,
      breakdown,
    }));
  }

  const historyCfg = config.ranking.history;
  if (historyCfg?.enabled === true) {
    const boosts = historyBoostsFor(
      jobs,
      deps?.applications ?? [],
      historyCfg.boostCap !== undefined ? { cap: historyCfg.boostCap } : {},
    );
    if (boosts.size > 0) {
      scored = scored.map((r) => {
        const boost = boosts.get(r.job.id);
        if (boost === undefined || boost === 1) return r;
        return { ...r, score: r.score * boost, breakdown: { ...r.breakdown, historyBoost: boost } };
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const ordered = await applyRerank(scored, config, deps?.reranker);
  return ordered.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
