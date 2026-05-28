/**
 * @file handlers/autoRevise.ts
 *
 * Feature: Auto-revise (action: "auto_revise")
 * Owner agent: E2 — Critique + Auto-revise
 *
 * Surgical-precision revision flow. The user supplies a target scope (a
 * specific bullet, section, role, or "whole-resume") plus an instruction.
 * Claude returns the FULL revised markdown; this handler then runs a strict
 * post-check that byte-compares every line OUTSIDE the scope and reports
 * any unauthorised changes back to the caller. The UI uses unauthorizedChanges
 * to warn the user before they accept the revision.
 *
 * Rule 14 (revision discipline) is LOAD-BEARING and is injected verbatim into
 * the system prompt for every call.
 *
 * Error policy:
 *   - Validation failures → ok:false, type:"validation", retryable:false
 *   - Claude transport errors → ok:false, retryable per ClaudeApiError.retryable
 *   - All public functions log [autoRevise] entry and exit
 */

import type { Deps } from '../Code.js';
import type {
  AutoReviseRequest,
  AutoReviseResult,
  ApiResult,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';
import { log } from '../lib/structuredLog.js';
import { buildSystemPrompt, buildUserMessage } from './autoRevise-prompt.js';
import {
  computeDiff,
  partitionUnauthorized,
  splitNormalisedLines,
  stripFences,
} from './autoRevise-diff.js';

export { validateAutoRevise } from './autoRevise-validation.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleAutoRevise(
  deps: Deps,
  req: AutoReviseRequest,
): ApiResult<AutoReviseResult> {
  log('info', 'autoRevise start', { scopeKind: req.targetScope.kind, model: req.model });

  const system = buildSystemPrompt(req.targetScope);
  const userMessage = buildUserMessage(req);

  // ── Call Claude ─────────────────────────────────────────────────────────
  let claudeResponse;
  try {
    claudeResponse = deps.claude.call({
      model: req.model,
      maxTokens: 4096,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log('error', 'autoRevise Claude API error', {
        errorType: err.errorType,
        status: err.statusCode,
        retryable: err.retryable,
        error: err.message,
      });
      return {
        ok: false,
        error: {
          type: err.errorType,
          message: err.message,
          retryable: err.retryable,
        },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'autoRevise unexpected Claude failure', { error: msg });
    return {
      ok: false,
      error: { type: 'server', message: msg, retryable: true },
    };
  }

  const revisedMarkdown = stripFences(claudeResponse.text);

  const diff = computeDiff(req.currentMarkdown, revisedMarkdown);
  const originalLines = splitNormalisedLines(req.currentMarkdown);
  const unauthorizedChanges = partitionUnauthorized(diff, req.targetScope, originalLines);

  if (unauthorizedChanges.length > 0) {
    log('warn', 'autoRevise: Claude made changes outside the requested scope (rule 14 violation)', {
      unauthorizedCount: unauthorizedChanges.length,
      scopeKind: req.targetScope.kind,
    });
  }

  const cost = calculateCost(claudeResponse.usage, claudeResponse.model);

  log('info', 'autoRevise done', {
    diffLines: diff.length,
    unauthorized: unauthorizedChanges.length,
    cost: cost.totalUsd,
  });

  return {
    ok: true,
    revisedMarkdown,
    diff,
    unauthorizedChanges,
    cost,
  };
}
