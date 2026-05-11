/**
 * @file handlers/coverLetter.ts
 *
 * Feature: Cover Letter (action: "cover_letter")
 * Owner agent: E3 — Cover Letter + Verify CL Hooks
 * Plan section: Phase 1 › Group E3
 *
 * Rule files to load (from prompts/shared/):
 *   - 10-cover-letter-industry.md  *** LOAD-BEARING — defines HOOK/EVIDENCE/CLOSING
 *     structure, 250-300 word target, industry-specific tone ***
 *   - 02-anti-fabrication.md       (no invented claims)
 *   - 01-priority-hierarchy.md     (truthfulness gate)
 *
 * Patterns to follow:
 *   - Handler shape: see handleGenerate() in Code.ts (reads source files, composes
 *     system prompt, calls Claude, writes output to Drive)
 *   - Source files read: deps.drive.readSourceFiles(req.sourceFolderId)
 *   - Rule files read: deps.drive.readRuleFiles(req.rulesFolderId)
 *   - Drive write: deps.drive.createFileInFolder() for .md, createGoogleDoc() for Doc
 *   - Cost tracking: calculateCost() in cost.ts
 */

import type { Deps } from '../Code.js';
import type {
  CoverLetterRequest,
  CoverLetterResult,
  CoverLetterTone,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';

// ---------------------------------------------------------------------------
// Tone profiles (see prompts/shared/15-cl-tones.md)
// ---------------------------------------------------------------------------

const VALID_TONES: readonly CoverLetterTone[] = [
  'formal',
  'casual',
  'technical',
  'persuasive',
  'neutral',
] as const;

/**
 * Per-tone directive injected into the system prompt. Each block references
 * the matching section of 15-cl-tones.md so the model loads the right
 * profile rather than restating every do/don't here.
 */
const TONE_DIRECTIVES: Record<Exclude<CoverLetterTone, 'neutral'>, string> = {
  formal:
    'Adopt the "formal" voice profile from 15-cl-tones.md. Use full forms (no contractions), ' +
    'multisyllabic Latinate vocabulary, third-person hints where natural, and measured cadence. ' +
    'Close with constructions such as "I would value the opportunity to discuss...". ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  casual:
    'Adopt the "casual" voice profile from 15-cl-tones.md. Use contractions, first-person ' +
    'reflection, and varied sentence lengths. Stay professional — casual is not careless. ' +
    'Close with warm constructions such as "I\'d love to bring this to your team". ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  technical:
    'Adopt the "technical" voice profile from 15-cl-tones.md. Lead with metrics, named systems, ' +
    'and precise engineering verbs (instrumented, refactored, sharded). Assume the reader is ' +
    'engineering-savvy; subordinate adjectives to data. Avoid padding adjectives like "robust" ' +
    'or "scalable". Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  persuasive:
    'Adopt the "persuasive" voice profile from 15-cl-tones.md. Open with a sharper hook, use ' +
    'vivid verbs, and place a single emotional word per paragraph at most ("compelled", ' +
    '"thrilled", "drawn to"). Energy is the signal, but do not cross into hype or sloganeering. ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
};

/** Build the tone directive block to append to the system prompt. */
function buildToneDirective(tone: Exclude<CoverLetterTone, 'neutral'>): string {
  return [
    '\n\n=== TONE: ' + tone + ' ===',
    TONE_DIRECTIVES[tone],
    '=== END TONE ===',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate a raw request body for the "cover_letter" action.
 * Returns null if valid, or an ApiErrorResponse if invalid.
 */
export function validateCoverLetter(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  const requiredStringFields = [
    'resumeMd',
    'jd',
    'jobFolderId',
    'sourceFolderId',
    'rulesFolderId',
    'model',
  ];

  for (const field of requiredStringFields) {
    if (!raw[field] || typeof raw[field] !== 'string') {
      console.warn(`[coverLetter] validation failed: missing or invalid field "${field}"`);
      return {
        ok: false,
        error: {
          type: 'validation',
          message: `Missing required field: ${field}`,
          retryable: false,
        },
      };
    }
  }

  // tone is optional but, if present, must be one of the known presets
  if (raw['tone'] !== undefined && raw['tone'] !== null) {
    if (
      typeof raw['tone'] !== 'string' ||
      !VALID_TONES.includes(raw['tone'] as CoverLetterTone)
    ) {
      console.warn(`[coverLetter] validation failed: invalid tone "${String(raw['tone'])}"`);
      return {
        ok: false,
        error: {
          type: 'validation',
          message:
            `Invalid tone: ${String(raw['tone'])}. ` +
            `Must be one of: ${VALID_TONES.join(', ')}`,
          retryable: false,
        },
      };
    }
  }

  // company and role are optional (string | null) — no validation needed
  return null;
}

// ---------------------------------------------------------------------------
// Helper: word count
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a "cover_letter" request.
 * Generates a HOOK/EVIDENCE/CLOSING cover letter (250-300 words) per rule
 * 10-cover-letter-industry.md. Saves as cover_letter.md + Google Doc.
 */
export function handleCoverLetter(
  deps: Deps,
  req: CoverLetterRequest,
): ApiResult<CoverLetterResult> {
  console.log(
    `[coverLetter] start company=${req.company ?? 'null'} role=${req.role ?? 'null'}`,
  );

  // 1. Read source materials
  let sourceMaterials: ReturnType<typeof deps.drive.readSourceFiles>;
  try {
    sourceMaterials = deps.drive.readSourceFiles(req.sourceFolderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[coverLetter] drive.readSourceFiles failed: ${message}`);
    return {
      ok: false,
      error: {
        type: 'drive',
        message: `Source folder error: ${message}`,
        retryable: false,
      },
    };
  }

  // 2. Read rule files
  let ruleFiles: ReturnType<typeof deps.drive.readRuleFiles>;
  try {
    ruleFiles = deps.drive.readRuleFiles(req.rulesFolderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[coverLetter] drive.readRuleFiles failed: ${message}`);
    return {
      ok: false,
      error: {
        type: 'drive',
        message: `Rules folder error: ${message}`,
        retryable: false,
      },
    };
  }

  // 3. Check that the CL rule is present (log warning if not)
  const hasCLRule = ruleFiles.some(f =>
    f.name.includes('10-cover-letter-industry'),
  );
  if (!hasCLRule) {
    console.warn(
      '[coverLetter] WARNING: 10-cover-letter-industry.md not found in rules folder. ' +
      'CL structure guidance will be absent from system prompt.',
    );
  }

  // 4. Compose system prompt; optionally append a tone directive
  const baseSystemPrompt = deps.prompt.composeSystemPrompt(ruleFiles);
  const systemPrompt =
    req.tone && req.tone !== 'neutral'
      ? { ...baseSystemPrompt, text: baseSystemPrompt.text + buildToneDirective(req.tone) }
      : baseSystemPrompt;

  if (req.tone && req.tone !== 'neutral') {
    console.log(`[coverLetter] tone directive applied: ${req.tone}`);
  }

  // 5. Build user message
  const sections: string[] = [];

  if (req.company || req.role) {
    sections.push(
      `Position: ${[req.role, req.company].filter(Boolean).join(' at ')}`,
    );
  }

  sections.push(`=== Job Description ===\n${req.jd}`);
  sections.push(`=== Candidate Resume ===\n${req.resumeMd}`);
  sections.push(`=== Source Materials ===\n${sourceMaterials.text}`);
  sections.push(
    'Write a cover letter following the HOOK/EVIDENCE/CLOSING structure. ' +
    '250-300 words. Output ONLY the cover letter text.',
  );

  const userMessage = sections.join('\n\n');

  // 6. Call Claude
  let claudeResponse: ReturnType<typeof deps.claude.call>;
  try {
    claudeResponse = deps.claude.call({
      model: req.model,
      maxTokens: 1024,
      system: [systemPrompt],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[coverLetter] Claude call failed: ${message}`);
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
        message: `Claude call failed: ${message}`,
        retryable: true,
      },
    };
  }

  const coverLetterMd = claudeResponse.text.trim();

  // 7. Write cover_letter.md to jobFolderId
  let mdFileUrl: string;
  try {
    const mdResult = deps.drive.createFileInFolder(
      req.jobFolderId,
      'cover_letter.md',
      coverLetterMd,
    );
    mdFileUrl = mdResult.fileUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[coverLetter] drive.createFileInFolder failed: ${message}`);
    return {
      ok: false,
      error: {
        type: 'drive',
        message: `Failed to write cover_letter.md: ${message}`,
        retryable: false,
      },
    };
  }

  // 8. Create Google Doc (failure is non-fatal — log and continue)
  let docUrl = '';
  try {
    const docResult = deps.drive.createGoogleDoc(
      req.jobFolderId,
      'cover_letter',
      coverLetterMd,
    );
    docUrl = docResult.docUrl;
  } catch (err) {
    console.warn(
      `[coverLetter] createGoogleDoc failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    // docUrl stays ''
  }

  // 8b. Optional sheet column update (non-fatal). When the caller provides
  // both sheetId and rowUrl, back-fill the "Cover Letter URL" column (v2
  // sheet column 20). Sheet update failures must NOT fail the handler.
  if (req.sheetId && req.rowUrl && docUrl) {
    try {
      deps.drive.updateSheetRow(req.sheetId, req.rowUrl, {
        coverLetterUrl: docUrl,
      });
    } catch (err) {
      console.warn(
        `[coverLetter] sheet update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 9. Compute cost
  const cost = calculateCost(claudeResponse.usage, claudeResponse.model);

  console.log(
    `[coverLetter] done wordCount=${wordCount(coverLetterMd)} cost=$${cost.totalUsd}`,
  );

  return {
    ok: true,
    coverLetterMd,
    docUrl,
    mdFileUrl,
    cost,
  };
}
