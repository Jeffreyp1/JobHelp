import type { JobDigestConfig, NormalizedJob, RankedJob, ScoreBreakdown } from '../types/index.js';
import { log } from '../lib/log.js';

/*
 * Ranking thresholds are deliberate defaults, not config-driven.
 *
 * Making them user-tunable requires extending JobDigestConfig.ranking with
 * { recencyFloor, recencyWindowDays }. The config schema in core/types/config.ts
 * is currently locked for this slice, so the values live here as DEFAULT_* constants.
 *
 * TODO_FUTURE: surface these via config.ranking once the schema can change.
 */
const DEFAULT_RECENCY_FLOOR = 0.5;
const DEFAULT_RECENCY_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/**
 * Rank jobs by keyword overlap × recency boost. Pure deterministic — no LLM calls.
 *
 * Design B: ranking.useLlmFitScore is silently ignored. breakdown.llmFitScore and
 * llmRationale are always undefined. The Phase 1 contract fields remain in the type
 * for forward-compatibility but are never populated here.
 */
export async function rank(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly RankedJob[]> {
  if (jobs.length === 0) return [];

  if (config.ranking.useLlmFitScore) {
    log('debug', 'rank.llm_fit_score_ignored', {});
  }

  const scored: RankedJob[] = jobs.map((job) => {
    const keywordOverlap = keywordOverlapScore(job, config.profile.skills);
    const recencyBoost = recencyBoostScore(job.postedAt);
    const score = keywordOverlap * recencyBoost;
    const breakdown: ScoreBreakdown = { keywordOverlap, recencyBoost };
    return { job, rank: 0, score, breakdown };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
