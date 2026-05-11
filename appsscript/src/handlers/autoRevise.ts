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
  AutoReviseDiff,
  ReviseTargetScope,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return {
    ok: false,
    error: { type: 'validation', message, retryable: false },
  };
}

const VALID_SCOPE_KINDS = ['bullet', 'section', 'role', 'whole-resume'] as const;

export function validateAutoRevise(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['currentMarkdown'] !== 'string' || (raw['currentMarkdown'] as string).length === 0) {
    console.warn('[autoRevise] validate fail: currentMarkdown missing/empty');
    return validationError('Missing or invalid required field: currentMarkdown');
  }
  if (typeof raw['instruction'] !== 'string' || (raw['instruction'] as string).length === 0) {
    console.warn('[autoRevise] validate fail: instruction missing/empty');
    return validationError('Missing or invalid required field: instruction');
  }
  // Reject whitespace-only instructions: rule 14 requires the instruction to
  // "explicitly authorise" lines, so " \n\t " carries no authorisation and
  // must not be accepted. Uses vanilla \s (no Unicode whitespace handling).
  if ((raw['instruction'] as string).trim().length === 0) {
    console.warn('[autoRevise] validate fail: instruction is whitespace-only');
    return validationError('instruction must be non-whitespace');
  }
  if (typeof raw['model'] !== 'string' || (raw['model'] as string).length === 0) {
    console.warn('[autoRevise] validate fail: model missing/empty');
    return validationError('Missing or invalid required field: model');
  }
  const scope = raw['targetScope'];
  if (!scope || typeof scope !== 'object') {
    console.warn('[autoRevise] validate fail: targetScope missing/not object');
    return validationError('Missing or invalid required field: targetScope');
  }
  const s = scope as Record<string, unknown>;
  const kind = s['kind'];
  if (typeof kind !== 'string' || !(VALID_SCOPE_KINDS as readonly string[]).includes(kind)) {
    console.warn(`[autoRevise] validate fail: invalid scope kind "${String(kind)}"`);
    return validationError(`targetScope.kind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  if (kind === 'bullet' && (typeof s['bulletId'] !== 'string' || (s['bulletId'] as string).length === 0)) {
    return validationError('targetScope.bulletId is required for kind="bullet"');
  }
  if (kind === 'section' && (typeof s['sectionName'] !== 'string' || (s['sectionName'] as string).length === 0)) {
    return validationError('targetScope.sectionName is required for kind="section"');
  }
  if (kind === 'role' && (typeof s['companyName'] !== 'string' || (s['companyName'] as string).length === 0)) {
    return validationError('targetScope.companyName is required for kind="role"');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scope description (for prompt)
// ---------------------------------------------------------------------------

function describeScope(scope: ReviseTargetScope): string {
  switch (scope.kind) {
    case 'bullet':
      return `the single bullet identified by id "${scope.bulletId}"`;
    case 'section':
      return `the section titled "${scope.sectionName}"`;
    case 'role':
      return `the role/experience entry under company "${scope.companyName}" (its header line and bullets)`;
    case 'whole-resume':
      return 'the entire document';
  }
}

// ---------------------------------------------------------------------------
// Rule 14 — load-bearing system prompt block
// (Inlined verbatim because Apps Script can't read prompts/ at runtime in
//  unit tests; keeps the constraint local and testable.)
// ---------------------------------------------------------------------------

const RULE_14_TEXT = [
  'RULE 14 — REVISION DISCIPLINE (LOAD-BEARING)',
  '',
  'When asked to revise scope X, return identical content for everything outside X.',
  '',
  'The output MUST be byte-identical to the input EXCEPT for lines the user',
  'instruction explicitly authorises. No "while I was at it" rewrites. No tone',
  'changes. No re-ordering. No silent bullet swaps. No global polish.',
  '',
  'Byte-identical means: same characters, same whitespace, same line breaks,',
  'same bold/italic markers, same punctuation (curly vs straight quotes,',
  'en-dash vs hyphen), same case.',
  '',
  'Allowed within scope: reword, reorder (within scope only), add/remove a',
  'bullet (only with explicit instruction), fix grammar, change emphasis.',
  '',
  'Forbidden anywhere: invent metrics, change dates/companies/titles, add',
  'facts not in source, modify any line outside the requested scope.',
  '',
  'Output: return the FULL revised markdown only, no preamble, no fences.',
  'A post-check will byte-compare every line outside the scope and flag any',
  'unauthorised changes — those revisions will be rejected.',
].join('\n');

function buildSystemPrompt(scope: ReviseTargetScope): string {
  const scopeDesc = describeScope(scope);
  return [
    'You are a precision resume editor. You will be given a markdown resume,',
    'an instruction, and a target scope. Apply the instruction ONLY within',
    'the target scope. Every line outside the scope must be byte-identical',
    'to the input.',
    '',
    RULE_14_TEXT,
    '',
    `Target scope for this request: ${scopeDesc}.`,
  ].join('\n');
}

function buildUserMessage(req: AutoReviseRequest): string {
  const scopeDesc = describeScope(req.targetScope);
  return [
    'Current markdown:',
    '```',
    req.currentMarkdown,
    '```',
    '',
    `Instruction: ${req.instruction}`,
    '',
    `Scope: ${scopeDesc}`,
    '',
    'Return the FULL revised markdown only — no preamble, no code fences, no explanation.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Strip code fences if Claude wrapped the response
// ---------------------------------------------------------------------------

function stripFences(text: string): string {
  // Only strip top-level ```markdown / ```md / ``` fences, NOT meaningful
  // interior whitespace. Rule 14 byte-identity includes line breaks, so a
  // trailing newline drift on the response must survive into the diff.
  // We tolerate optional surrounding whitespace OUTSIDE the fence (LLMs
  // sometimes add a single leading/trailing newline around the fence
  // delimiters themselves), but if the response is unfenced we return it
  // exactly as-is.
  const fenceRe = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = text.match(fenceRe);
  if (match && match[1] !== undefined) return match[1];
  return text;
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/** Normalise CRLF and bare CR to LF so the diff doesn't pick up line-ending
 *  drift as spurious unauthorised changes. Rule 14 "byte-identical" is
 *  enforced on LF-normalised content — line-ending differences are a
 *  transport artefact (Windows clients, copy-paste through some browsers),
 *  not a semantic edit. */
function normaliseLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function computeDiff(original: string, revised: string): AutoReviseDiff[] {
  // Rule-14 byte-identity check operates on LF-normalised content; see
  // normaliseLineEndings() above for rationale.
  const o = normaliseLineEndings(original).split('\n');
  const r = normaliseLineEndings(revised).split('\n');
  const diff: AutoReviseDiff[] = [];
  const max = Math.max(o.length, r.length);
  for (let i = 0; i < max; i++) {
    const beforePresent = i < o.length;
    const afterPresent = i < r.length;
    const before = beforePresent ? o[i] : '';
    const after = afterPresent ? r[i] : '';
    // A line is a diff entry if (a) both sides exist and content differs,
    // or (b) one side has a line at this index that the other lacks. The
    // latter case catches trailing-newline drift (one side has '' present
    // past the other's EOF) so rule-14 "same line breaks" is enforced.
    if (beforePresent !== afterPresent || before !== after) {
      diff.push({ lineIndex: i, before, after });
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Scope detection — find the line range that's "in scope"
// Returns inclusive [start, end] indexes into the ORIGINAL line array.
// Returns null if the scope can't be located (e.g., bulletId not present).
// ---------------------------------------------------------------------------

interface LineRange {
  start: number;
  end: number;
}

/** Find the bullet line by id pattern: `<!-- bullet-id: <id> -->` */
function findBulletRange(originalLines: string[], bulletId: string): LineRange | null {
  const needle = `bullet-id: ${bulletId}`;
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].includes(needle)) {
      return { start: i, end: i };
    }
  }
  return null;
}

/** Find a section by its heading text. A "section" is from the heading line to (but not including) the next heading of equal or higher level, or EOF. */
function findSectionRange(originalLines: string[], sectionName: string): LineRange | null {
  // Find heading line: ^#{1,6}\s+<sectionName>\s*$
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].trim().toLowerCase() === sectionName.toLowerCase()) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  // Walk forward until next heading of level <= startLevel
  let endIdx = originalLines.length - 1;
  for (let i = startIdx + 1; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i - 1;
      break;
    }
  }
  return { start: startIdx, end: endIdx };
}

/**
 * Find a role by company name. A "role" is a heading line that contains the
 * company name (e.g. "### Google — Software Engineering Intern"), through the
 * subsequent lines until the next heading of equal or higher level.
 */
function findRoleRange(originalLines: string[], companyName: string): LineRange | null {
  let startIdx = -1;
  let startLevel = 0;
  const lower = companyName.toLowerCase();
  for (let i = 0; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].toLowerCase().includes(lower)) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = originalLines.length - 1;
  for (let i = startIdx + 1; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i - 1;
      break;
    }
  }
  return { start: startIdx, end: endIdx };
}

function rangeContains(range: LineRange, lineIndex: number): boolean {
  return lineIndex >= range.start && lineIndex <= range.end;
}

/**
 * Partition the diff into authorised vs unauthorised changes given the scope.
 * - bullet/section/role: a diff line is authorised iff its lineIndex falls
 *   within the original-document range of the scope.
 * - whole-resume: every change is authorised.
 *
 * For lineIndex values beyond the original-line count (i.e., Claude added
 * extra trailing lines), we count them as in-scope only when scope is whole-resume.
 */
function partitionUnauthorized(
  diff: AutoReviseDiff[],
  scope: ReviseTargetScope,
  originalLines: string[],
): AutoReviseDiff[] {
  if (scope.kind === 'whole-resume') return [];

  let range: LineRange | null = null;
  if (scope.kind === 'bullet') {
    range = findBulletRange(originalLines, scope.bulletId);
  } else if (scope.kind === 'section') {
    range = findSectionRange(originalLines, scope.sectionName);
  } else if (scope.kind === 'role') {
    range = findRoleRange(originalLines, scope.companyName);
  }

  if (!range) {
    // Can't locate the scope — treat ALL diff entries as unauthorised so the UI warns.
    console.warn(`[autoRevise] scope not found in source markdown — treating all changes as unauthorized`);
    return diff.slice();
  }

  const unauthorized: AutoReviseDiff[] = [];
  for (const d of diff) {
    if (d.lineIndex < originalLines.length) {
      if (!rangeContains(range, d.lineIndex)) {
        unauthorized.push(d);
      }
    } else {
      // Trailing addition past EOF of original: only ok if scope reaches EOF
      if (range.end !== originalLines.length - 1) {
        unauthorized.push(d);
      }
    }
  }
  return unauthorized;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleAutoRevise(
  deps: Deps,
  req: AutoReviseRequest,
): ApiResult<AutoReviseResult> {
  console.log(`[autoRevise] start scope=${req.targetScope.kind} model=${req.model}`);

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
      console.error(`[autoRevise] Claude error type=${err.errorType} status=${err.statusCode}: ${err.message}`);
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
    console.error(`[autoRevise] unexpected Claude failure: ${msg}`);
    return {
      ok: false,
      error: { type: 'server', message: msg, retryable: true },
    };
  }

  const revisedMarkdown = stripFences(claudeResponse.text);

  const diff = computeDiff(req.currentMarkdown, revisedMarkdown);
  // Use the same LF-normalised view of the original as computeDiff so that
  // scope-line indexes line up with diff entry lineIndex values regardless
  // of input line endings. (The client-facing revisedMarkdown is left as-is.)
  const originalLines = req.currentMarkdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unauthorizedChanges = partitionUnauthorized(diff, req.targetScope, originalLines);

  if (unauthorizedChanges.length > 0) {
    console.warn(`[autoRevise] WARNING: ${unauthorizedChanges.length} unauthorized changes detected`);
  }

  const cost = calculateCost(claudeResponse.usage, claudeResponse.model);

  console.log(
    `[autoRevise] done diffLines=${diff.length} unauthorized=${unauthorizedChanges.length} cost=$${cost.totalUsd}`,
  );

  return {
    ok: true,
    revisedMarkdown,
    diff,
    unauthorizedChanges,
    cost,
  };
}
