/**
 * @file handlers/critique.ts
 *
 * Feature: Critique (action: "critique")
 * Owner agent: E2 — Critique + Auto-revise
 *
 * Runs a second Claude call after generation to score the resume on 8
 * dimensions and produce a tiered list of improvements. Optionally writes
 * critique.md to the per-job folder when jobFolderId is supplied.
 *
 * Error policy:
 *   - Validation failures → ok:false, type:"validation", retryable:false
 *   - Claude transport errors → ok:false, retryable per ClaudeApiError.retryable
 *   - Malformed JSON in Claude response → ok:false, type:"server", retryable:true
 *   - Drive write failures → DEGRADED ok:true with critiqueDocUrl=null (non-fatal)
 *   - All public functions log [critique] entry and exit
 */

import type { Deps } from '../Code.js';
import type {
  CritiqueRequest,
  CritiqueResult,
  CritiqueScore,
  CritiqueImprovement,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Constants — 8-dimension rubric
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<string, number> = {
  keyword_coverage: 0.2,
  bullet_impact: 0.2,
  structure: 0.15,
  formatting: 0.1,
  relevance: 0.15,
  truthfulness: 0.05,
  conciseness: 0.1,
  ats_friendliness: 0.05,
};

const DIMENSION_NAMES = Object.keys(DIMENSION_WEIGHTS);

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return {
    ok: false,
    error: { type: 'validation', message, retryable: false },
  };
}

export function validateCritique(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['resumeMd'] !== 'string' || raw['resumeMd'].length === 0) {
    console.warn('[critique] validate fail: resumeMd missing/empty');
    return validationError('Missing or invalid required field: resumeMd');
  }
  if (typeof raw['jd'] !== 'string' || raw['jd'].length === 0) {
    console.warn('[critique] validate fail: jd missing/empty');
    return validationError('Missing or invalid required field: jd');
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    console.warn('[critique] validate fail: model missing/empty');
    return validationError('Missing or invalid required field: model');
  }
  // jobInsights / jobFolderId are optional and either object|null|string|null
  if (raw['jobFolderId'] !== undefined &&
      raw['jobFolderId'] !== null &&
      typeof raw['jobFolderId'] !== 'string') {
    console.warn('[critique] validate fail: jobFolderId must be string|null');
    return validationError('jobFolderId must be a string or null');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    'You are an expert resume coach evaluating a tailored resume against a job description.',
    'Score the resume on these 8 dimensions and propose tiered improvements.',
    '',
    'Dimensions and weights:',
    '  - keyword_coverage (0.20): how well JD keywords are reflected in the resume',
    '  - bullet_impact   (0.20): bullets quantified, action-led, outcome-focused',
    '  - structure       (0.15): logical section order and hierarchy',
    '  - formatting      (0.10): consistency of markup, dates, capitalisation',
    '  - relevance       (0.15): material aligned to the JD; irrelevant bullets removed',
    '  - truthfulness    (0.05): no fabricated facts or unsupported metrics',
    '  - conciseness     (0.10): tight wording, no filler',
    '  - ats_friendliness(0.05): ATS-readable plain markdown, no unparseable structures',
    '',
    'Score each dimension 0–10. Use the listed weight. Notes should be one sentence.',
    'Improvements: tier 1 = highest impact, tier 2 = moderate, tier 3 = polish.',
    'Include AT LEAST 1 tier-1 and 2 tier-2 improvements. expectedDelta is a 0–1 score-improvement estimate.',
    '',
    'Return ONLY valid JSON, no preamble, with this exact shape:',
    '{',
    '  "scores": [{"dimension": "<name>", "score": <0-10>, "weight": <number>, "notes": "<sentence>"}],',
    '  "improvements": [{"tier": 1|2|3, "text": "<sentence>", "expectedDelta": <0-1>}]',
    '}',
  ].join('\n');
}

function buildUserMessage(req: CritiqueRequest): string {
  const sections: string[] = [];
  sections.push(`=== Job Description ===\n${req.jd}`);
  if (req.jobInsights) {
    try {
      sections.push(`=== Job Insights ===\n${JSON.stringify(req.jobInsights, null, 2)}`);
    } catch {
      // ignore — jobInsights is optional context
    }
  }
  sections.push(`=== Resume (Markdown) ===\n${req.resumeMd}`);
  sections.push('Return the JSON critique now.');
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface RawCritiqueShape {
  scores?: unknown;
  improvements?: unknown;
}

function tryExtractJson(text: string): string {
  // Allow Claude to return a JSON object even if wrapped in code fences.
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  return trimmed;
}

function parseCritiqueJson(text: string): { scores: CritiqueScore[]; improvements: CritiqueImprovement[] } {
  const cleaned = tryExtractJson(text);
  const parsed = JSON.parse(cleaned) as RawCritiqueShape;

  if (!Array.isArray(parsed.scores)) {
    throw new Error('Critique JSON missing scores[] array');
  }
  if (!Array.isArray(parsed.improvements)) {
    throw new Error('Critique JSON missing improvements[] array');
  }

  const scores: CritiqueScore[] = parsed.scores.map((raw, i) => {
    const s = raw as Record<string, unknown>;
    if (typeof s['dimension'] !== 'string') {
      throw new Error(`scores[${i}].dimension must be string`);
    }
    if (typeof s['score'] !== 'number') {
      throw new Error(`scores[${i}].score must be number`);
    }
    return {
      dimension: s['dimension'] as string,
      score: s['score'] as number,
      weight: typeof s['weight'] === 'number'
        ? (s['weight'] as number)
        : (DIMENSION_WEIGHTS[s['dimension'] as string] ?? 0),
      notes: typeof s['notes'] === 'string' ? (s['notes'] as string) : '',
    };
  });

  // Ensure all 8 expected dimensions are present; backfill any missing with 0.
  const presentDims = new Set(scores.map(s => s.dimension));
  for (const dim of DIMENSION_NAMES) {
    if (!presentDims.has(dim)) {
      scores.push({
        dimension: dim,
        score: 0,
        weight: DIMENSION_WEIGHTS[dim],
        notes: 'Missing from Claude response — defaulted to 0',
      });
    }
  }

  const improvements: CritiqueImprovement[] = parsed.improvements.map((raw, i) => {
    const imp = raw as Record<string, unknown>;
    const tier = imp['tier'];
    if (tier !== 1 && tier !== 2 && tier !== 3) {
      throw new Error(`improvements[${i}].tier must be 1, 2, or 3`);
    }
    if (typeof imp['text'] !== 'string') {
      throw new Error(`improvements[${i}].text must be string`);
    }
    return {
      tier: tier as 1 | 2 | 3,
      text: imp['text'] as string,
      expectedDelta: typeof imp['expectedDelta'] === 'number' ? (imp['expectedDelta'] as number) : 0,
    };
  });

  return { scores, improvements };
}

function computeWeightedTotal(scores: CritiqueScore[]): number {
  const total = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
  // Round to 4 decimals for stable comparisons
  return Math.round(total * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Markdown formatter for critique.md
// ---------------------------------------------------------------------------

function formatCritiqueMarkdown(
  scores: CritiqueScore[],
  improvements: CritiqueImprovement[],
  totalScore: number,
): string {
  const lines: string[] = [];
  lines.push('# Resume Critique');
  lines.push('');
  lines.push(`**Total weighted score:** ${totalScore.toFixed(2)} / 10`);
  lines.push('');
  lines.push('## Dimension Scores');
  lines.push('');
  lines.push('| Dimension | Score | Weight | Notes |');
  lines.push('|---|---|---|---|');
  for (const s of scores) {
    const notes = s.notes.replace(/\|/g, '\\|');
    lines.push(`| ${s.dimension} | ${s.score} | ${s.weight} | ${notes} |`);
  }
  lines.push('');
  lines.push('## Improvements');
  lines.push('');
  for (const tier of [1, 2, 3] as const) {
    const tierItems = improvements.filter(i => i.tier === tier);
    if (tierItems.length === 0) continue;
    lines.push(`### Tier ${tier}`);
    lines.push('');
    for (const item of tierItems) {
      lines.push(`- ${item.text} (expected Δ ${item.expectedDelta.toFixed(2)})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleCritique(
  deps: Deps,
  req: CritiqueRequest,
): ApiResult<CritiqueResult> {
  console.log(`[critique] start model=${req.model} jobFolderId=${req.jobFolderId ?? 'null'}`);

  const system = buildSystemPrompt();
  const userMessage = buildUserMessage(req);

  // ── Call Claude ─────────────────────────────────────────────────────────
  let claudeResponse;
  try {
    claudeResponse = deps.claude.call({
      model: req.model,
      maxTokens: 2048,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      console.error(`[critique] Claude error type=${err.errorType} status=${err.statusCode}: ${err.message}`);
      return {
        ok: false,
        error: {
          type: err.errorType === 'auth' ? 'auth' : err.errorType === 'validation' ? 'validation' : 'server',
          message: err.message,
          retryable: err.retryable,
        },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[critique] unexpected Claude failure: ${msg}`);
    return {
      ok: false,
      error: { type: 'server', message: msg, retryable: true },
    };
  }

  // ── Parse JSON ──────────────────────────────────────────────────────────
  let scores: CritiqueScore[];
  let improvements: CritiqueImprovement[];
  try {
    const parsed = parseCritiqueJson(claudeResponse.text);
    scores = parsed.scores;
    improvements = parsed.improvements;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[critique] failed to parse Claude JSON: ${msg}`);
    return {
      ok: false,
      error: {
        type: 'server',
        message: `Critique response was not valid JSON: ${msg}`,
        retryable: true,
      },
    };
  }

  const totalScore = computeWeightedTotal(scores);

  // ── Optional drive write (non-fatal) ───────────────────────────────────
  let critiqueDocUrl: string | null = null;
  if (req.jobFolderId) {
    try {
      const md = formatCritiqueMarkdown(scores, improvements, totalScore);
      // DriveOps does not currently expose a generic createFileInFolder — use
      // writeOutput which creates a Google Doc inside the folder.
      // ⚠ CROSS-IMPACT noted: a future drive helper for raw markdown files would
      // be cleaner, but this satisfies the contract (returns docUrl).
      const { docUrl } = deps.drive.writeOutput(req.jobFolderId, 'critique', md);
      critiqueDocUrl = docUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[critique] drive write failed (non-fatal): ${msg}`);
      // Degraded: keep ok:true, just leave critiqueDocUrl=null
      critiqueDocUrl = null;
    }
  }

  const cost = calculateCost(claudeResponse.usage, claudeResponse.model);

  console.log(`[critique] done score=${totalScore.toFixed(2)} cost=$${cost.totalUsd}`);

  return {
    ok: true,
    scores,
    totalScore,
    improvements,
    critiqueDocUrl,
    cost,
  };
}
