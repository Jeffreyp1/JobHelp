/**
 * @file handlers/benchmark.ts
 *
 * Feature: Benchmark Role (action: "benchmark_role")
 * Owner agent: E1 — Research + LinkedIn Benchmarking
 * Plan section: Phase 1 › Group E1
 *
 * Rule files to load (from prompts/shared/):
 *   - 01-priority-hierarchy.md  (output truthfulness gate)
 *   - 02-anti-fabrication.md    (no hallucinated role patterns)
 *
 * Patterns:
 *   - CacheService key = "benchmark:<company>:<role>", TTL 86400s.
 *   - Same Claude/error/JSON-parse handling shape as research.ts.
 *   - Result includes patterns (a coherent paragraph or bulleted list
 *     describing what successful candidates look like).
 *
 * Tests: appsscript/tests/handlers/benchmark.test.ts
 */

import type { Deps } from '../Code.js';
import type {
  BenchmarkRoleRequest,
  BenchmarkRoleResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import type { ClaudeRequest } from '../types/claude-api.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Apps Script CacheService ambient declaration
// ---------------------------------------------------------------------------

declare const CacheService: {
  getScriptCache(): {
    get(key: string): string | null;
    put(key: string, value: string, ttlSeconds?: number): void;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 86400;

const SYSTEM_PROMPT =
  'You are a role-benchmarking assistant. Given a company name and role, ' +
  'identify what successful candidates for that role at that company look like ' +
  'based on public LinkedIn-style profile patterns and job postings. ' +
  'Return a JSON object with EXACTLY these keys: ' +
  'patterns (string — a coherent paragraph or bulleted list, 3-8 sentences, ' +
  'describing typical experience, skills, and trajectory of successful candidates), ' +
  'keywords (string[] — 5-15 keywords useful for tailoring a resume to this role), ' +
  'sources ({title, url}[] — at least 1, prefer 2-5 reputable URLs from LinkedIn or job boards). ' +
  'Use the web_search tool for live profile/posting data. ' +
  'NEVER fabricate. If unsure, say "unclear" in patterns. ' +
  'Return JSON only — no preamble, no markdown fences.';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

/**
 * Validate a raw request body for the "benchmark_role" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateBenchmarkRole(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['company'] !== 'string' || raw['company'].length === 0) {
    return validationError('Missing or invalid required field: company');
  }
  if (typeof raw['role'] !== 'string' || raw['role'].length === 0) {
    return validationError('Missing or invalid required field: role');
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    return validationError('Missing or invalid required field: model');
  }
  if ('forceRefresh' in raw && raw['forceRefresh'] !== undefined) {
    if (typeof raw['forceRefresh'] !== 'boolean') {
      return validationError('Field "forceRefresh" must be a boolean');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface CachedBenchmarkPayload {
  patterns: string;
  keywords: string[];
  sources: { title: string; url: string }[];
  cost: BenchmarkRoleResult['cost'];
}

/**
 * Handle a "benchmark_role" request.
 * Always returns ApiResult<BenchmarkRoleResult>; never throws.
 */
export function handleBenchmarkRole(
  deps: Deps,
  req: BenchmarkRoleRequest,
): ApiResult<BenchmarkRoleResult> {
  const forceRefresh = req.forceRefresh === true;
  console.log(
    `[benchmark] start company="${req.company}" role="${req.role}" forceRefresh=${forceRefresh}`,
  );

  // Defensive validation
  const validationErr = validateBenchmarkRole(
    req as unknown as Record<string, unknown>,
  );
  if (validationErr) {
    console.error(`[benchmark] validation error: ${validationErr.error.message}`);
    return validationErr;
  }

  const cacheKey = `benchmark:${req.company}:${req.role}`;

  // 1) Cache check unless forceRefresh
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      console.log(`[benchmark] cache hit key=${cacheKey}`);
      return {
        ok: true,
        patterns: cached.patterns,
        keywords: cached.keywords,
        sources: cached.sources,
        cached: true,
        cost: cached.cost,
      };
    }
    console.log(`[benchmark] cache miss key=${cacheKey}`);
  } else {
    console.log(`[benchmark] forceRefresh — skipping cache lookup`);
  }

  // 2) Build Claude request
  const userMessage =
    `What do successful candidates for the role "${req.role}" at "${req.company}" look like? ` +
    `Search LinkedIn-style profiles and job postings to find typical experience, ` +
    `skills, education, and career trajectory. Return JSON only.`;

  const claudeReq: ClaudeRequest & {
    tools?: { type: string; name: string }[];
  } = {
    model: req.model,
    maxTokens: 1024,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: userMessage }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  };

  // 3) Call Claude
  let response;
  try {
    response = deps.claude.call(claudeReq);
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      console.error(
        `[benchmark] Claude API error type=${err.errorType} status=${err.statusCode} retryable=${err.retryable}: ${err.message}`,
      );
      return {
        ok: false,
        error: {
          type: err.errorType,
          message: err.message,
          retryable: err.retryable,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] Claude call failed (non-typed): ${message}`);
    return {
      ok: false,
      error: { type: 'server', message, retryable: true },
    };
  }

  // 4) Parse JSON
  let parsed: { patterns: unknown; keywords: unknown; sources: unknown };
  try {
    parsed = JSON.parse(stripJsonFences(response.text)) as typeof parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] Claude returned invalid JSON: ${message}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Claude returned invalid JSON: ${message}`,
        retryable: true,
      },
    };
  }

  // 5) Shape-check
  const shapeError = validateClaudePayload(parsed);
  if (shapeError) {
    console.error(`[benchmark] Claude payload shape error: ${shapeError}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Claude returned malformed payload: ${shapeError}`,
        retryable: true,
      },
    };
  }

  const patterns = parsed.patterns as string;
  const keywords = parsed.keywords as string[];
  const sources = parsed.sources as { title: string; url: string }[];

  // 6) Cost
  const cost = calculateCost(response.usage, response.model);

  // 7) Write to cache
  const cachePayload: CachedBenchmarkPayload = { patterns, keywords, sources, cost };
  writeCache(cacheKey, cachePayload);

  console.log(
    `[benchmark] done cost=$${cost.totalUsd} cached=false keywords=${keywords.length} sources=${sources.length}`,
  );
  return {
    ok: true,
    patterns,
    keywords,
    sources,
    cached: false,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readCache(key: string): CachedBenchmarkPayload | null {
  try {
    if (typeof CacheService === 'undefined') return null;
    const raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedBenchmarkPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] cache read failed key=${key}: ${message}`);
    return null;
  }
}

function writeCache(key: string, payload: CachedBenchmarkPayload): void {
  try {
    if (typeof CacheService === 'undefined') return;
    CacheService.getScriptCache().put(key, JSON.stringify(payload), CACHE_TTL_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] cache write failed key=${key}: ${message}`);
  }
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validateClaudePayload(p: {
  patterns: unknown;
  keywords: unknown;
  sources: unknown;
}): string | null {
  if (typeof p.patterns !== 'string' || p.patterns.length === 0) {
    return 'patterns must be a non-empty string';
  }
  if (!Array.isArray(p.keywords) || !p.keywords.every((k) => typeof k === 'string')) {
    return 'keywords must be an array of strings';
  }
  if (!Array.isArray(p.sources)) {
    return 'sources must be an array';
  }
  for (const s of p.sources) {
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof (s as { title?: unknown }).title !== 'string' ||
      typeof (s as { url?: unknown }).url !== 'string'
    ) {
      return 'each source must have string title + url';
    }
  }
  return null;
}
