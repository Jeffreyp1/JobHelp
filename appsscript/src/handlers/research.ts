/**
 * @file handlers/research.ts
 *
 * Feature: Research Company (action: "research_company")
 * Owner agent: E1 — Research + LinkedIn Benchmarking
 * Plan section: Phase 1 › Group E1
 *
 * Rule files to load (from prompts/shared/):
 *   - 01-priority-hierarchy.md  (output truthfulness gate)
 *   - 02-anti-fabrication.md    (no hallucinated company facts)
 *
 * Patterns:
 *   - Handler shape: see handleGenerate() in Code.ts
 *   - Error normalisation: validationError pattern below
 *   - Claude call: deps.claude.call({model, maxTokens, system, messages})
 *   - CacheService pattern: CacheService.getScriptCache() keyed by
 *     "research:<company>:<role>" with 86400s TTL
 *
 * Behaviour:
 *   - Validates inputs (company, model required; role optional string|null)
 *   - Cache check before Claude (skipped if forceRefresh=true)
 *   - Anthropic web_search_20250305 tool requested for live company facts
 *   - Returns {summary, keywords[], sources[]} as ResearchCompanyResult
 *   - Computes CostBreakdown via calculateCost()
 *   - console.log on entry/exit (every path) — NO silent failures
 *   - All error paths return ApiResult<never> with ok:false — never throws
 *   - Network/Claude failures → retryable: true
 *   - Validation failures → retryable: false, type: "validation"
 *   - JSON parse failures → retryable: true, type: "server"
 */

import type { Deps } from '../Code.js';
import type {
  ResearchCompanyRequest,
  ResearchCompanyResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import type { ClaudeRequest } from '../types/claude-api.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Apps Script CacheService ambient declaration (for tests + production)
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

const CACHE_TTL_SECONDS = 86400; // 24 hours

const SYSTEM_PROMPT =
  'You are a company research assistant. Given a company name and (optionally) a target role, ' +
  'return a JSON object with EXACTLY these keys: ' +
  'summary (string — 2-4 sentences on culture, mission, products, tech), ' +
  'keywords (string[] — 5-15 short keywords useful for resume tailoring), ' +
  'sources ({title, url}[] — at least 1, prefer 2-5 reputable URLs). ' +
  'Use the web_search tool to find accurate, current information. ' +
  'NEVER fabricate. If a fact is uncertain, say "unclear" in the summary. ' +
  'Return JSON only — no preamble, no markdown fences.';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

/**
 * Validate a raw request body for the "research_company" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateResearchCompany(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['company'] !== 'string' || raw['company'].length === 0) {
    return validationError('Missing or invalid required field: company');
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    return validationError('Missing or invalid required field: model');
  }
  // role is optional: must be string or null/undefined
  if ('role' in raw && raw['role'] !== null && raw['role'] !== undefined) {
    if (typeof raw['role'] !== 'string') {
      return validationError('Field "role" must be a string or null');
    }
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

interface CachedResearchPayload {
  summary: string;
  keywords: string[];
  sources: { title: string; url: string }[];
  cost: ResearchCompanyResult['cost'];
}

/**
 * Handle a "research_company" request.
 * Always returns ApiResult<ResearchCompanyResult>; never throws.
 */
export function handleResearchCompany(
  deps: Deps,
  req: ResearchCompanyRequest,
): ApiResult<ResearchCompanyResult> {
  const forceRefresh = req.forceRefresh === true;
  console.log(
    `[research] start company="${req.company}" role="${req.role ?? 'null'}" forceRefresh=${forceRefresh}`,
  );

  // Defensive validation in case caller bypassed validateResearchCompany
  const validationErr = validateResearchCompany(
    req as unknown as Record<string, unknown>,
  );
  if (validationErr) {
    console.error(`[research] validation error: ${validationErr.error.message}`);
    return validationErr;
  }

  // Use JSON-encoded tuple so `:` and `"` in company/role can't collide.
  // E.g. (company="Acme:foo", role="bar") was previously key-identical to
  // (company="Acme", role="foo:bar"). T1/C8 probe.
  const cacheKey = `research:${JSON.stringify([req.company, req.role ?? ''])}`;

  // 1) Cache check unless forceRefresh
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      console.log(`[research] cache hit key=${cacheKey}`);
      return {
        ok: true,
        summary: cached.summary,
        keywords: cached.keywords,
        sources: cached.sources,
        cached: true,
        cost: cached.cost,
      };
    }
    console.log(`[research] cache miss key=${cacheKey}`);
  } else {
    console.log(`[research] forceRefresh — skipping cache lookup`);
  }

  // 2) Build Claude request
  const userMessage =
    `Research the company "${req.company}" focusing on culture, mission, products, ` +
    `tech stack, and hiring patterns` +
    (req.role ? ` for the role "${req.role}"` : '') +
    `. Return JSON only.`;

  // ClaudeRequest type doesn't currently expose `tools`, but the production
  // claude.ts passthrough is JSON-driven. We inject the web_search tool
  // alongside the typed fields so production gets live web search while
  // tests (which mock claude.call) don't see it as a typed-shape mismatch.
  const claudeReq: ClaudeRequest & {
    tools?: { type: string; name: string }[];
  } = {
    model: req.model,
    maxTokens: 1024,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: userMessage }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  };

  // 3) Call Claude (typed try/catch — no silent failure)
  let response;
  try {
    response = deps.claude.call(claudeReq);
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      console.error(
        `[research] Claude API error type=${err.errorType} status=${err.statusCode} retryable=${err.retryable}: ${err.message}`,
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
    console.error(`[research] Claude call failed (non-typed): ${message}`);
    return {
      ok: false,
      error: { type: 'server', message, retryable: true },
    };
  }

  // 4) Parse JSON payload from Claude
  let parsed: { summary: unknown; keywords: unknown; sources: unknown };
  try {
    parsed = JSON.parse(stripJsonFences(response.text)) as typeof parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[research] Claude returned invalid JSON: ${message}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Claude returned invalid JSON: ${message}`,
        retryable: true,
      },
    };
  }

  // 5) Shape-check parsed payload
  const shapeError = validateClaudePayload(parsed);
  if (shapeError) {
    console.error(`[research] Claude payload shape error: ${shapeError}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Claude returned malformed payload: ${shapeError}`,
        retryable: true,
      },
    };
  }

  const summary = parsed.summary as string;
  const keywords = parsed.keywords as string[];
  const sources = parsed.sources as { title: string; url: string }[];

  // 6) Compute cost
  const cost = calculateCost(response.usage, response.model);

  // 7) Write to cache (always — even on forceRefresh)
  const cachePayload: CachedResearchPayload = { summary, keywords, sources, cost };
  writeCache(cacheKey, cachePayload);

  console.log(
    `[research] done cost=$${cost.totalUsd} cached=false keywords=${keywords.length} sources=${sources.length}`,
  );
  return {
    ok: true,
    summary,
    keywords,
    sources,
    cached: false,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readCache(key: string): CachedResearchPayload | null {
  try {
    if (typeof CacheService === 'undefined') return null;
    const raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResearchPayload;
  } catch (err) {
    // Cache failures must not fail the request — log and proceed
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[research] cache read failed key=${key}: ${message}`);
    return null;
  }
}

function writeCache(key: string, payload: CachedResearchPayload): void {
  try {
    if (typeof CacheService === 'undefined') return;
    CacheService.getScriptCache().put(key, JSON.stringify(payload), CACHE_TTL_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[research] cache write failed key=${key}: ${message}`);
  }
}

/** Strip optional ```json fences if Claude wrapped the JSON. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Returns null if shape OK, else a string describing what's wrong. */
function validateClaudePayload(p: {
  summary: unknown;
  keywords: unknown;
  sources: unknown;
}): string | null {
  if (typeof p.summary !== 'string' || p.summary.length === 0) {
    return 'summary must be a non-empty string';
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
