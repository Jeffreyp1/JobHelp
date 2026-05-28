/**
 * @file handlers/discoverAndRank.ts
 *
 * Feature: Discover + Rank jobs (action: "discover_and_rank")
 * Owner agent: J4 — Phase 1 job-pipeline handlers
 *
 * Behaviour:
 *   1) discoverJobs(config, profile.searchQueries) → dedupJobs → discoveredCount
 *   2) rankJobs(deduped, profile, { maxDaysOld, topN, claude?, fitScoreModel? })
 *      → { ranked, cost }. rankedCount is the length of the returned (top-N'd)
 *      list — the brief accepts this as an approximation of "survived the
 *      keyword pre-filter"; rankJobs doesn't surface the pre-filter count.
 *   3) if deps.drive.upsertJobPipelineRows exists, map RankedJob[] → JobPipelineRow[]
 *      (status:'new', tailoredDocUrl:null, notes:'') and upsert; take sheetUrl
 *      from the result. Otherwise sheetUrl='' and a warn is logged.
 *   4) return { discoveredCount, rankedCount, jobs: ranked, sheetUrl, cost }
 *
 * Discovery + ranking can be slow (multiple HTTP fetches + batched Claude calls)
 * and Apps Script enforces a 6-minute execution limit — the daily-digest cron
 * should keep topN modest. We can't reliably detect proximity to the limit, so
 * this is just a note.
 *
 * Error policy: discovery + ranking failures are wrapped so the handler never
 * throws across the HTTP boundary. ClaudeApiError surfaced from rankJobs is
 * forwarded with its errorType/retryable; any other thrown Error → type:"server"
 * retryable:true; a Drive upsert failure → driveError (type:"drive", retryable:false).
 */

import type { Deps } from '../Code.js';
import type {
  DiscoverAndRankRequest,
  DiscoverAndRankResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import type { JobPipelineRow, RankedJob } from '../types/job-discovery.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { discoverJobs, dedupJobs } from '../lib/jobDiscovery.js';
import { rankJobs } from '../lib/jobRanking.js';
import { log } from '../lib/structuredLog.js';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

function driveError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'drive', message, retryable: false } };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a raw request body for the "discover_and_rank" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 *
 * Spot-checks the profile (skills array, searchQueries array) and the config
 * object rather than fully validating their shapes — the libs are defensive
 * about missing fields, but we want garbage to fail loudly here, not mid-fetch.
 */
export function validateDiscoverAndRank(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  const profile = raw['profile'];
  if (!isObj(profile)) {
    return validationError('Missing or invalid required field: profile (must be an object)');
  }
  if (!Array.isArray(profile['skills'])) {
    return validationError('Field "profile.skills" must be an array');
  }
  if (!Array.isArray(profile['searchQueries'])) {
    return validationError('Field "profile.searchQueries" must be an array');
  }
  if (!isObj(raw['config'])) {
    return validationError('Missing or invalid required field: config (must be an object)');
  }
  if (typeof raw['sheetId'] !== 'string' || raw['sheetId'].length === 0) {
    return validationError('Missing or invalid required field: sheetId');
  }
  if (typeof raw['maxDaysOld'] !== 'number' || !isFinite(raw['maxDaysOld']) || raw['maxDaysOld'] < 0) {
    return validationError('Field "maxDaysOld" must be a number >= 0');
  }
  if (typeof raw['topN'] !== 'number' || !isFinite(raw['topN']) || raw['topN'] < 1) {
    return validationError('Field "topN" must be a number >= 1');
  }
  if ('fitScoreModel' in raw && raw['fitScoreModel'] !== undefined) {
    if (typeof raw['fitScoreModel'] !== 'string' || raw['fitScoreModel'].length === 0) {
      return validationError('Field "fitScoreModel" must be a non-empty string when provided');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toPipelineRow(job: RankedJob): JobPipelineRow {
  return {
    jobId: job.id,
    discoveredAt: job.discoveredAt,
    postedAt: job.postedAt,
    source: job.source,
    company: job.company,
    title: job.title,
    location: job.location,
    url: job.url,
    finalScore: job.finalScore,
    matchedSkills: job.matchedSkills,
    missingSkills: job.missingSkills,
    status: 'new',
    tailoredDocUrl: null,
    notes: '',
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a "discover_and_rank" request.
 * Always returns ApiResult<DiscoverAndRankResult>; never throws.
 */
export function handleDiscoverAndRank(
  deps: Deps,
  req: DiscoverAndRankRequest,
): ApiResult<DiscoverAndRankResult> {
  log('info', 'discover_and_rank start', {
    sheetId: req.sheetId,
    maxDaysOld: req.maxDaysOld,
    topN: req.topN,
    fitScoreModel: req.fitScoreModel ?? null,
  });

  const validationErr = validateDiscoverAndRank(req as unknown as Record<string, unknown>);
  if (validationErr) {
    log('warn', 'discover_and_rank validation error', { message: validationErr.error.message });
    return validationErr;
  }

  // 1) Discovery + dedup
  let discoveredCount: number;
  let deduped;
  try {
    const raw = discoverJobs(req.config, req.profile.searchQueries);
    deduped = dedupJobs(raw);
    discoveredCount = deduped.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'discover_and_rank: discovery failed', { error: message });
    return { ok: false, error: { type: 'server', message, retryable: true } };
  }

  // 2) Ranking (Stage A + optional Stage B fit-score)
  let ranked: RankedJob[];
  let rankCost;
  try {
    const result = rankJobs(deduped, req.profile, {
      maxDaysOld: req.maxDaysOld,
      topN: req.topN,
      claude: req.fitScoreModel ? deps.claude : undefined,
      fitScoreModel: req.fitScoreModel,
    });
    ranked = result.ranked;
    rankCost = result.cost;
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log('error', 'discover_and_rank Claude API error during ranking', {
        errorType: err.errorType,
        status: err.statusCode,
        retryable: err.retryable,
        error: err.message,
      });
      return { ok: false, error: { type: err.errorType, message: err.message, retryable: err.retryable } };
    }
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'discover_and_rank: ranking failed', { error: message });
    return { ok: false, error: { type: 'server', message, retryable: true } };
  }
  const rankedCount = ranked.length;

  // 3) Upsert into the Job Pipeline sheet, if those Drive ops are available
  let sheetUrl = '';
  if (typeof deps.drive.upsertJobPipelineRows === 'function') {
    const rows = ranked.map(toPipelineRow);
    try {
      const result = deps.drive.upsertJobPipelineRows(req.sheetId, rows);
      sheetUrl = result.sheetUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'discover_and_rank: Job Pipeline upsert failed', { error: message, sheetId: req.sheetId });
      return driveError(message);
    }
  } else {
    log('warn', 'discover_and_rank: Job Pipeline sheet ops unavailable — skipping sheet write', {
      sheetId: req.sheetId,
    });
  }

  log('info', 'discover_and_rank done', {
    discoveredCount,
    rankedCount,
    sheetUrl,
    cost: rankCost.totalUsd,
  });
  return {
    ok: true,
    discoveredCount,
    rankedCount,
    jobs: ranked,
    sheetUrl,
    cost: rankCost,
  };
}
