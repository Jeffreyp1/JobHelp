/**
 * @file handlers/verifyHooks.ts
 *
 * Feature: Verify Cover Letter Hooks (action: "verify_cl_hooks")
 * Owner agent: E3 — Cover Letter + Verify CL Hooks
 * Plan section: Phase 1 › Group E3
 *
 * Two-step process:
 *   1. Entity extraction — Claude call (no tools) to find named entities.
 *   2. Per-entity verification — Claude call WITH web_search_20250305 to
 *      confirm each entity's existence. Failures per entity → "uncertain".
 *
 * Accumulates cost across ALL Claude calls (extraction + N searches).
 */

import type { Deps } from '../Code.js';
import type {
  VerifyClHooksRequest,
  VerifyClHooksResult,
  ApiResult,
  ApiErrorResponse,
  HookVerification,
  CostBreakdown,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate a raw request body for the "verify_cl_hooks" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateVerifyClHooks(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (!raw['coverLetterMd'] || typeof raw['coverLetterMd'] !== 'string') {
    console.warn('[verifyHooks] validation failed: missing or invalid field "coverLetterMd"');
    return {
      ok: false,
      error: {
        type: 'validation',
        message: 'Missing required field: coverLetterMd',
        retryable: false,
      },
    };
  }

  if (!raw['model'] || typeof raw['model'] !== 'string') {
    console.warn('[verifyHooks] validation failed: missing or invalid field "model"');
    return {
      ok: false,
      error: {
        type: 'validation',
        message: 'Missing required field: model',
        retryable: false,
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cost accumulator helper
// ---------------------------------------------------------------------------

function accumulateCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    totalUsd: Math.round((a.totalUsd + b.totalUsd) * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Entity type
// ---------------------------------------------------------------------------

interface ExtractedEntity {
  entity: string;
  entityType: string;
}

interface SearchResult {
  status: 'verified' | 'unverified' | 'uncertain';
  sources?: { title: string; url: string }[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a "verify_cl_hooks" request.
 *
 * STEP 1: Extract named entities from the cover letter (Claude, no web_search).
 * STEP 2: For each entity, call Claude WITH web_search_20250305 to verify.
 *         Per-entity failures → mark "uncertain", continue (don't abort).
 */
export function handleVerifyClHooks(
  deps: Deps,
  req: VerifyClHooksRequest,
): ApiResult<VerifyClHooksResult> {
  console.log(`[verifyHooks] start model=${req.model}`);

  // ── STEP 1: Entity extraction ────────────────────────────────────────────
  let extractionResponse: ReturnType<typeof deps.claude.call>;
  try {
    extractionResponse = deps.claude.call({
      model: req.model,
      maxTokens: 512,
      system: [
        {
          type: 'text',
          text:
            'Extract all named entities from this cover letter that could be verified: ' +
            'PI names, product names, program names, company names, paper titles, ' +
            'statistics, awards. Return ONLY a JSON array: [{entity, entityType}]. ' +
            'If no entities are found, return an empty array [].',
        },
      ],
      messages: [{ role: 'user', content: req.coverLetterMd }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[verifyHooks] entity extraction Claude call failed: ${message}`);
    if (err instanceof ClaudeApiError) {
      return {
        ok: false,
        error: {
          type: err.errorType,
          message: err.message,
          retryable: err.retryable,
        },
      };
    }
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Entity extraction failed: ${message}`,
        retryable: true,
      },
    };
  }

  // Parse extracted entities
  let entities: ExtractedEntity[];
  try {
    const parsed = JSON.parse(extractionResponse.text.trim());
    if (!Array.isArray(parsed)) {
      throw new Error('Extraction response is not a JSON array');
    }
    entities = parsed as ExtractedEntity[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[verifyHooks] failed to parse entity extraction JSON: ${message}`);
    console.warn(`[verifyHooks] raw extraction text: ${extractionResponse.text.slice(0, 200)}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Failed to parse entity extraction response: ${message}`,
        retryable: true,
      },
    };
  }

  // Accumulate extraction cost
  let totalCost = calculateCost(extractionResponse.usage, extractionResponse.model);

  // Short-circuit: no entities found
  if (entities.length === 0) {
    console.log(`[verifyHooks] done entities=0 unverified=0 cost=$${totalCost.totalUsd}`);
    return {
      ok: true,
      verifications: [],
      unverifiedCount: 0,
      cost: totalCost,
    };
  }

  console.log(`[verifyHooks] extracted ${entities.length} entities, verifying each...`);

  // ── STEP 2: Verify each entity via web_search ────────────────────────────
  const verifications: HookVerification[] = [];

  for (const { entity, entityType } of entities) {
    try {
      const searchResponse = deps.claude.call({
        model: req.model,
        maxTokens: 256,
        system: [
          {
            type: 'text',
            text: 'You are a fact-checker. Search the web to verify whether the named entity exists.',
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              `Does "${entity}" (${entityType}) exist? Search and confirm. ` +
              `Return ONLY a JSON object: ` +
              `{"status": "verified"|"unverified"|"uncertain", ` +
              `"sources": [{"title": string, "url": string}], ` +
              `"reason": string (optional, for unverified/uncertain)}`,
          },
        ],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      });

      let parsed: SearchResult;
      try {
        parsed = JSON.parse(searchResponse.text.trim()) as SearchResult;
      } catch {
        // Non-JSON search response → treat as uncertain
        console.warn(
          `[verifyHooks] non-JSON search response for "${entity}": ${searchResponse.text.slice(0, 100)}`,
        );
        verifications.push({
          entity,
          entityType,
          status: 'uncertain',
          sources: [],
          reason: `Search response was not valid JSON: ${searchResponse.text.slice(0, 100)}`,
        });
        totalCost = accumulateCost(
          totalCost,
          calculateCost(searchResponse.usage, searchResponse.model),
        );
        continue;
      }

      totalCost = accumulateCost(
        totalCost,
        calculateCost(searchResponse.usage, searchResponse.model),
      );

      verifications.push({
        entity,
        entityType,
        status: parsed.status ?? 'uncertain',
        sources: parsed.sources ?? [],
        reason: parsed.reason,
      });
    } catch (err) {
      // Per-entity search failure → mark uncertain, continue
      console.warn(
        `[verifyHooks] search failed for entity "${entity}" (${entityType}):`,
        err instanceof Error ? err.message : String(err),
      );
      verifications.push({
        entity,
        entityType,
        status: 'uncertain',
        sources: [],
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const unverifiedCount = verifications.filter(v => v.status === 'unverified').length;

  console.log(
    `[verifyHooks] done entities=${verifications.length} unverified=${unverifiedCount} cost=$${totalCost.totalUsd}`,
  );

  return {
    ok: true,
    verifications,
    unverifiedCount,
    cost: totalCost,
  };
}
