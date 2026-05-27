/**
 * @file triggers.ts
 *
 * Time-based trigger glue for the Phase 1 job-pipeline daily digest.
 *
 *   installDailyJobDigest() — run once from the Apps Script editor (or a setup
 *     menu) to register a daily time-based trigger that invokes
 *     runDailyJobDigest at ~07:00 in the script's timezone.
 *
 *   runDailyJobDigest() — the function Apps Script calls on schedule. It reads
 *     the digest config from Script Properties, builds a discover_and_rank
 *     request, and runs the handler. Kept deliberately thin — it's glue.
 *
 * Script Property `JOBHELP_DIGEST_CONFIG` holds a JSON blob:
 *   {
 *     "profile":       JobProfile,        // distilled by extract_profile
 *     "config":        DiscoveryConfig,   // which sources to poll
 *     "maxDaysOld":    number,            // drop postings older than this (0 = no limit)
 *     "topN":          number,            // return at most this many — KEEP MODEST
 *                                          (discover+rank does many HTTP fetches and
 *                                           batched Claude calls; Apps Script caps
 *                                           execution at 6 minutes)
 *     "fitScoreModel": string | undefined,// run the Stage-B Claude fit-score if set
 *     "sheetId":       string             // Job Pipeline spreadsheet id
 *   }
 *
 * A thrown error inside a time-based trigger emails the script owner, so
 * runDailyJobDigest never throws: a missing/malformed config logs a warn and
 * returns, and the handler itself never throws (returns ApiResult).
 */

import type { Deps } from './Code.js';
import type { DiscoverAndRankRequest } from './types/api-contract.js';
import type { DriveOps } from './types/drive-ops.js';
import type { ClaudeClient } from './types/claude-api.js';
import { handleDiscoverAndRank } from './handlers/discoverAndRank.js';
import { log } from './lib/structuredLog.js';

// Production dependencies — esbuild inlines these. Mirrors Code.ts's resolveDeps.
import { driveOps as productionDriveOps } from './drive.js';
import { callClaude as productionCallClaude } from './claude.js';
import { composeSystemPrompt as productionComposeSystemPrompt } from './prompt.js';

// ---------------------------------------------------------------------------
// GAS ambient declarations (also defined for the vitest runtime as undefined)
// ---------------------------------------------------------------------------

declare const ScriptApp: {
  newTrigger(functionName: string): {
    timeBased(): {
      everyDays(n: number): {
        atHour(h: number): {
          create(): unknown;
        };
      };
    };
  };
};

declare const PropertiesService: {
  getScriptProperties(): {
    getProperty(key: string): string | null;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIGEST_CONFIG_PROPERTY = 'JOBHELP_DIGEST_CONFIG';
const DIGEST_HANDLER_NAME = 'runDailyJobDigest';
const DIGEST_HOUR = 7;

// ---------------------------------------------------------------------------
// Deps resolution (mirrors Code.ts — kept here so triggers.ts has no extra
// surface dependency on Code.ts beyond the Deps type)
// ---------------------------------------------------------------------------

function resolveDeps(): Deps {
  return {
    drive: productionDriveOps as DriveOps,
    claude: { call: productionCallClaude } as ClaudeClient,
    prompt: { composeSystemPrompt: productionComposeSystemPrompt },
  };
}

// ---------------------------------------------------------------------------
// Trigger installer
// ---------------------------------------------------------------------------

/**
 * Register a daily time-based trigger for runDailyJobDigest.
 * Safe to call from the Apps Script editor. No-op under vitest (ScriptApp absent).
 */
export function installDailyJobDigest(): void {
  if (typeof ScriptApp === 'undefined') {
    log('warn', 'installDailyJobDigest: ScriptApp unavailable — not installing trigger');
    return;
  }
  ScriptApp.newTrigger(DIGEST_HANDLER_NAME).timeBased().everyDays(1).atHour(DIGEST_HOUR).create();
  log('info', 'installDailyJobDigest: daily trigger installed', { handler: DIGEST_HANDLER_NAME, hour: DIGEST_HOUR });
}

// ---------------------------------------------------------------------------
// Scheduled handler
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read the digest config from Script Properties, returning a discover_and_rank
 * request, or null if the property is missing/malformed (logs a warn).
 */
function readDigestRequest(): DiscoverAndRankRequest | null {
  if (typeof PropertiesService === 'undefined') {
    log('warn', 'runDailyJobDigest: PropertiesService unavailable');
    return null;
  }
  let rawValue: string | null;
  try {
    rawValue = PropertiesService.getScriptProperties().getProperty(DIGEST_CONFIG_PROPERTY);
  } catch (err) {
    log('warn', 'runDailyJobDigest: failed reading Script Properties', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!rawValue) {
    log('warn', 'runDailyJobDigest: no digest config — set Script Property to enable', {
      property: DIGEST_CONFIG_PROPERTY,
    });
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    log('warn', 'runDailyJobDigest: digest config is not valid JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!isObj(parsed)) {
    log('warn', 'runDailyJobDigest: digest config is not a JSON object');
    return null;
  }
  if (!isObj(parsed['profile']) || !isObj(parsed['config']) || typeof parsed['sheetId'] !== 'string') {
    log('warn', 'runDailyJobDigest: digest config missing required fields (profile, config, sheetId)');
    return null;
  }
  return {
    action: 'discover_and_rank',
    profile: parsed['profile'] as unknown as DiscoverAndRankRequest['profile'],
    config: parsed['config'] as unknown as DiscoverAndRankRequest['config'],
    maxDaysOld: typeof parsed['maxDaysOld'] === 'number' ? parsed['maxDaysOld'] : 0,
    topN: typeof parsed['topN'] === 'number' ? parsed['topN'] : 10,
    fitScoreModel: typeof parsed['fitScoreModel'] === 'string' ? parsed['fitScoreModel'] : undefined,
    sheetId: parsed['sheetId'] as string,
  };
}

/**
 * Entry point invoked by the daily time-based trigger. Never throws.
 */
export function runDailyJobDigest(): void {
  log('info', 'runDailyJobDigest start');
  const req = readDigestRequest();
  if (!req) {
    log('info', 'runDailyJobDigest: nothing to do');
    return;
  }
  let result;
  try {
    result = handleDiscoverAndRank(resolveDeps(), req);
  } catch (err) {
    // handleDiscoverAndRank shouldn't throw, but a trigger must never surface one.
    log('error', 'runDailyJobDigest: handler threw unexpectedly', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (result.ok) {
    log('info', 'runDailyJobDigest done', {
      discoveredCount: result.discoveredCount,
      rankedCount: result.rankedCount,
      sheetUrl: result.sheetUrl,
      cost: result.cost.totalUsd,
    });
  } else {
    log('warn', 'runDailyJobDigest: discover_and_rank returned an error', {
      type: result.error.type,
      message: result.error.message,
      retryable: result.error.retryable,
    });
  }
}
