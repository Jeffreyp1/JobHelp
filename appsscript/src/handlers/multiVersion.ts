/**
 * @file handlers/multiVersion.ts
 *
 * Feature: Multi-version Generation (action: "multi_version")
 * Owner agent: E4 — Multi-version
 * Plan section: Phase 1 › Group E4
 *
 * Generates N resume variants from the same source materials, each with a
 * different framing directive appended to the base system prompt. Source and
 * rule files are read exactly once and shared across all Claude calls.
 *
 * Apps Script V8 does NOT support Promise.all() — variant calls run sequentially.
 */

import type { Deps } from '../Code.js';
import type {
  MultiVersionRequest,
  MultiVersionResult,
  MultiVersionVariant,
  CostBreakdown,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { calculateCost } from '../cost.js';
import { buildUserMessage, buildJobInsightsSummary } from '../message-builder.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FRAMINGS = [
  'Technical depth',
  'Leadership',
  'Business outcomes',
  'Startup generalist',
  'Cross-functional impact',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

function driveError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'drive', message, retryable: false } };
}

/** Accumulate two CostBreakdown objects into one. totalUsd is rounded to 4 dp. */
export function accumulateCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    totalUsd: Math.round((a.totalUsd + b.totalUsd) * 10000) / 10000,
  };
}

/** Build the framing directive block for a given label. */
function buildFramingDirective(framing: string): string {
  return [
    '\n\n=== FRAMING DIRECTIVE ===',
    `Emphasize "${framing}" throughout this resume. Reorder and reframe bullets to`,
    'foreground this lens without adding fabricated content or inventing experience.',
    'All content must remain factually grounded in the source materials.',
    '=== END FRAMING ===',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate a raw request body for the "multi_version" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateMultiVersion(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  // Required string fields
  for (const field of ['jd', 'sourceFolderId', 'rulesFolderId', 'model'] as const) {
    if (!raw[field] || typeof raw[field] !== 'string') {
      return validationError(`Missing or invalid required field: ${field}`);
    }
  }

  // count: required integer, 2 ≤ count ≤ 5
  if (typeof raw['count'] !== 'number' || !Number.isInteger(raw['count'])) {
    return validationError('count must be an integer');
  }
  const count = raw['count'] as number;
  if (count < 2 || count > 5) {
    return validationError('count must be between 2 and 5 (inclusive)');
  }

  // company / role: optional, but if present must be string or null
  if (raw['company'] !== undefined && raw['company'] !== null && typeof raw['company'] !== 'string') {
    return validationError('company must be a string or null');
  }
  if (raw['role'] !== undefined && raw['role'] !== null && typeof raw['role'] !== 'string') {
    return validationError('role must be a string or null');
  }

  // framings: optional; if present, must be string[] with length === count
  if (raw['framings'] !== undefined) {
    if (!Array.isArray(raw['framings'])) {
      return validationError('framings must be an array of strings');
    }
    for (const f of raw['framings'] as unknown[]) {
      if (typeof f !== 'string') {
        return validationError('framings must be an array of strings');
      }
    }
    if ((raw['framings'] as string[]).length !== count) {
      return validationError('framings.length must equal count');
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a "multi_version" request.
 * Reads source/rule files once, then fans out N sequential Claude calls,
 * each with a different framing directive appended to the system prompt.
 * Returns all-or-nothing: any variant failure → ok: false immediately.
 */
export function handleMultiVersion(
  deps: Deps,
  req: MultiVersionRequest,
): ApiResult<MultiVersionResult> {
  console.log(`[multiVersion] start count=${req.count} model=${req.model}`);

  // 1. Read source materials ONCE
  let sourceMaterials: ReturnType<typeof deps.drive.readSourceFiles>;
  try {
    sourceMaterials = deps.drive.readSourceFiles(req.sourceFolderId);
  } catch (err) {
    return driveError(String(err));
  }

  // 2. Read rule files ONCE
  let ruleFiles: ReturnType<typeof deps.drive.readRuleFiles>;
  try {
    ruleFiles = deps.drive.readRuleFiles(req.rulesFolderId);
  } catch (err) {
    return driveError('Rules folder error: ' + String(err));
  }

  // 3. Compose base system prompt ONCE
  const baseSystem = deps.prompt.composeSystemPrompt(ruleFiles);

  // 4. Resolve framings
  const framings: string[] = req.framings ?? DEFAULT_FRAMINGS.slice(0, req.count);

  // 5. Build base user message (shared across all variants)
  const baseUserMessage = buildUserMessage({
    jd: req.jd,
    company: req.company,
    role: req.role,
    jobInsightsSummary: req.jobInsights ? buildJobInsightsSummary(req.jobInsights) : '',
    sourceMaterialsText: sourceMaterials.text,
    appendFinalInstruction: false,
  });

  // 6. Sequential variant generation (Apps Script cannot use Promise.all)
  const variants: MultiVersionVariant[] = [];
  let accumulatedCost: CostBreakdown = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalUsd: 0,
  };

  for (let i = 0; i < req.count; i++) {
    const framing = framings[i];
    const framingDirective = buildFramingDirective(framing);

    // Append framing to system prompt text
    const framingSystem = { ...baseSystem, text: baseSystem.text + framingDirective };

    const userContent =
      baseUserMessage +
      '\n\nUsing the rules and framing above, produce a tailored resume in Markdown. Output ONLY the resume markdown.';

    let response: ReturnType<typeof deps.claude.call>;
    try {
      response = deps.claude.call({
        model: req.model,
        maxTokens: 4096,
        system: [framingSystem],
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (err) {
      console.error(`[multiVersion] variant ${i + 1} failed (framing="${framing}"):`, err);
      return {
        ok: false,
        error: {
          type: 'server',
          message: `Variant ${i + 1} ("${framing}") failed: ${String(err)}`,
          retryable: true,
        },
      };
    }

    const variantCost = calculateCost(response.usage, response.model);
    accumulatedCost = accumulateCost(accumulatedCost, variantCost);

    console.log(
      `[multiVersion] variant ${i + 1}/${req.count} framing="${framing}" done cost=$${variantCost.totalUsd}`,
    );

    variants.push({
      label: framing,
      framing: framingDirective,
      markdown: response.text.trim(),
    });
  }

  console.log(`[multiVersion] done totalCost=$${accumulatedCost.totalUsd}`);

  return { ok: true, variants, cost: accumulatedCost };
}
