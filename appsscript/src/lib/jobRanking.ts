/**
 * Job ranking: score DiscoveredJob[] against a JobProfile.
 *
 *   Stage A (free): keyword overlap between JD and profile.skills.
 *   Recency boost:  newer postings rank higher (0.5..1 multiplier).
 *   Stage B (optional, batched Claude calls): semantic fit on the survivors.
 *   final = fit (or keyword if no fit) * recencyBoost.
 */

import type { DiscoveredJob, JobProfile, RankedJob } from '../types/job-discovery.js';
import type { ClaudeClient } from '../types/claude-api.js';
import { ClaudeApiError } from '../types/claude-api.js';
import type { CostBreakdown } from '../types/api-contract.js';
import { calculateCost } from '../cost.js';
import { log } from './structuredLog.js';

const KEYWORD_THRESHOLD = 0.1;
const FALLBACK_DAYS_OLD = 14;
const RECENCY_HALFLIFE_DAYS = 30;
const RECENCY_FLOOR = 0.5;
const BATCH_SIZE = 5;
const JD_TRUNCATE_CHARS = 1500;

const FIT_SYSTEM_PROMPT =
  'Score how well a candidate fits each job, 0-100, given their profile summary.';

function zeroCost(): CostBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalUsd: 0,
  };
}

function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  const totalUsd = Math.round((a.totalUsd + b.totalUsd) * 10_000) / 10_000;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    totalUsd,
  };
}

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function skillPresent(haystack: string, skill: string): boolean {
  const needle = skill.toLowerCase().trim();
  if (!needle) return false;
  if (/\s/.test(needle)) {
    return haystack.includes(needle);
  }
  // single token — match on word-ish boundaries (allows +/# etc. in the skill)
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'i');
  return re.test(haystack);
}

function daysOldOf(job: DiscoveredJob, now: number): number {
  if (typeof job.postedAt === 'number' && isFinite(job.postedAt)) {
    return (now - job.postedAt) / 86_400_000;
  }
  return FALLBACK_DAYS_OLD;
}

function recencyBoostOf(daysOld: number): number {
  return Math.max(RECENCY_FLOOR, 1 - daysOld / RECENCY_HALFLIFE_DAYS);
}

interface StageAJob extends RankedJob {
  _daysOld: number;
}

function stageOne(jobs: DiscoveredJob[], profile: JobProfile, now: number): StageAJob[] {
  const skills = profile.skills.filter((s) => typeof s === 'string' && s.trim().length > 0);
  const total = skills.length;
  return jobs.map((job) => {
    const text = `${job.title} ${job.descriptionText}`.toLowerCase();
    const matched: string[] = [];
    const missing: string[] = [];
    for (const skill of skills) {
      if (skillPresent(text, skill)) matched.push(skill);
      else missing.push(skill);
    }
    const keywordScore = total === 0 ? 0 : clamp01(matched.length / total);
    const daysOld = daysOldOf(job, now);
    const recencyBoost = recencyBoostOf(daysOld);
    return {
      ...job,
      keywordScore,
      fitScore: null,
      recencyBoost,
      finalScore: keywordScore * recencyBoost,
      matchedSkills: matched,
      missingSkills: missing,
      _daysOld: daysOld,
    };
  });
}

interface FitResultItem {
  index: number;
  score: number;
  reason: string;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseFitBatch(text: string, batchSize: number): Map<number, FitResultItem> {
  const parsed = JSON.parse(stripJsonFences(text)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('fit-score response was not a JSON array');
  const out = new Map<number, FitResultItem>();
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const index = o['index'];
    const score = o['score'];
    if (typeof index !== 'number' || index < 0 || index >= batchSize) continue;
    if (typeof score !== 'number' || !isFinite(score)) continue;
    out.set(Math.trunc(index), {
      index: Math.trunc(index),
      score: Math.max(0, Math.min(100, score)),
      reason: typeof o['reason'] === 'string' ? o['reason'] : '',
    });
  }
  return out;
}

function runStageB(
  survivors: StageAJob[],
  profile: JobProfile,
  claude: ClaudeClient,
  fitScoreModel: string,
  topN: number,
): { scored: StageAJob[]; cost: CostBreakdown } {
  // Sort by keyword*recency, take top min(topN*2, count).
  const sorted = survivors
    .slice()
    .sort((a, b) => b.keywordScore * b.recencyBoost - a.keywordScore * a.recencyBoost);
  const count = Math.min(Math.max(topN, 0) * 2, sorted.length);
  const candidates = sorted.slice(0, count);

  let cost = zeroCost();
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const userMessage = [
      'Candidate profile summary:',
      profile.summary || '(no summary provided)',
      '',
      'Jobs to score (by index):',
      ...batch.map((job, idx) => {
        const jd = job.descriptionText.slice(0, JD_TRUNCATE_CHARS);
        return `--- index ${idx} ---\nTitle: ${job.title}\nCompany: ${job.company}\nDescription: ${jd}`;
      }),
      '',
      'Return ONLY a JSON array: [{"index": <number>, "score": <0-100>, "reason": "<short>"}]',
    ].join('\n');

    let response;
    try {
      response = claude.call({
        model: fitScoreModel,
        maxTokens: 1024,
        system: [{ type: 'text', text: FIT_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      if (err instanceof ClaudeApiError) {
        log('warn', 'rankJobs Stage-B Claude API error — keyword fallback for batch', {
          errorType: err.errorType,
          status: err.statusCode,
          batchSize: batch.length,
          error: err.message,
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log('warn', 'rankJobs Stage-B Claude call failed — keyword fallback for batch', {
          batchSize: batch.length,
          error: message,
        });
      }
      for (const job of batch) job.fitScore = job.keywordScore;
      continue;
    }

    cost = addCost(cost, calculateCost(response.usage, response.model));

    let results: Map<number, FitResultItem>;
    try {
      results = parseFitBatch(response.text, batch.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('warn', 'rankJobs Stage-B parse failure — keyword fallback for batch', {
        batchSize: batch.length,
        error: message,
        textSnippet: response.text.slice(0, 200),
      });
      for (const job of batch) job.fitScore = job.keywordScore;
      continue;
    }

    batch.forEach((job, idx) => {
      const r = results.get(idx);
      job.fitScore = r ? clamp01(r.score / 100) : job.keywordScore;
    });
  }

  return { scored: candidates, cost };
}

/**
 * Rank `jobs` against `profile`. If `claude` + `fitScoreModel` are provided,
 * run the Stage-B fit score on the top survivors; otherwise rank by keyword
 * overlap * recency only. `maxDaysOld` of 0 means no recency hard-filter.
 * Returns the ranked list (descending finalScore) plus accumulated cost.
 */
export function rankJobs(
  jobs: DiscoveredJob[],
  profile: JobProfile,
  opts: { maxDaysOld: number; topN: number; claude?: ClaudeClient; fitScoreModel?: string },
): { ranked: RankedJob[]; cost: CostBreakdown } {
  const now = Date.now();
  const inputCount = jobs.length;
  const topN = Math.max(0, Math.trunc(opts.topN));
  const useFitScore = !!(opts.claude && opts.fitScoreModel);

  log('info', 'rankJobs start', {
    inputCount,
    topN,
    maxDaysOld: opts.maxDaysOld,
    useFitScore,
  });

  let scored = stageOne(jobs, profile, now);

  // Hard recency filter.
  if (opts.maxDaysOld > 0) {
    scored = scored.filter((j) => j._daysOld <= opts.maxDaysOld);
  }

  // Keyword threshold drop — but never go below topN survivors.
  const passing = scored.filter((j) => j.keywordScore >= KEYWORD_THRESHOLD);
  if (passing.length >= topN) {
    scored = passing;
  } else {
    scored = scored
      .slice()
      .sort((a, b) => b.keywordScore - a.keywordScore)
      .slice(0, Math.min(topN, scored.length));
  }
  const afterFilter = scored.length;

  let cost = zeroCost();
  let usedFitScore = false;
  if (useFitScore && scored.length > 0) {
    const stageB = runStageB(scored, profile, opts.claude!, opts.fitScoreModel!, topN);
    cost = stageB.cost;
    usedFitScore = stageB.scored.some((j) => j.fitScore !== null);
  }

  // Recompute finalScore now that fitScore may be set.
  for (const job of scored) {
    job.finalScore = job.fitScore != null
      ? job.fitScore * job.recencyBoost
      : job.keywordScore * job.recencyBoost;
  }

  scored.sort((a, b) => b.finalScore - a.finalScore);
  const ranked: RankedJob[] = scored.slice(0, topN).map((j) => {
    const { _daysOld, ...rest } = j;
    void _daysOld;
    return rest;
  });

  log('info', 'rankJobs done', {
    inputCount,
    afterFilter,
    returned: ranked.length,
    usedFitScore,
    cost: cost.totalUsd,
  });

  return { ranked, cost };
}
