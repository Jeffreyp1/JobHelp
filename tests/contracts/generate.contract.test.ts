/**
 * @file tests/contracts/generate.contract.test.ts
 *
 * BLACK-BOX contract tests for action "generate". The test sends raw JSON
 * through `doPost()` and asserts only the wire-level response shape against
 * the `GenerateResult` / `ApiErrorResponse` types declared in
 * `appsscript/src/types/api-contract.ts`.
 *
 * Nothing inside `handleGenerate` is reached for; only the request/response
 * boundary is verified. Failures in this file indicate the contract has
 * drifted from what the extension is allowed to rely on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doPost } from '../../appsscript/src/Code.js';
import type {
  GenerateRequest,
  ApiErrorResponse,
} from '../../appsscript/src/types/api-contract.js';
import {
  ERROR_TYPES,
  JOB_FOLDER_ID,
  MODEL,
  OUTPUT_FOLDER_ID,
  RULES_FOLDER_ID,
  SHEET_ID,
  SOURCE_FOLDER_ID,
  installCacheServiceStub,
  isApiError,
  isObject,
  makeClaudeMock,
  makeClaudeResponse,
  makeDriveMock,
  makeEvent,
  makePromptMock,
  parseOutput,
} from './_setup.js';
import type {
  ClaudeClient,
  ClaudeRequest,
} from '../../appsscript/src/types/claude-api.js';
import type { DriveOps } from '../../appsscript/src/types/drive-ops.js';

// Build a complete GenerateRequest. Tests override individual fields to
// produce missing-field variants.
function makeGenerateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    action: 'generate',
    jd: 'We need a Python developer with 5 years experience.',
    company: 'Acme',
    role: 'Senior Engineer',
    url: 'https://example.com/job/123',
    jobInsights: null,
    toggles: {},
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    outputFolderId: OUTPUT_FOLDER_ID,
    sheetId: SHEET_ID,
    model: MODEL,
    ...overrides,
  };
}

describe('contract: action="generate"', () => {
  let drive: DriveOps;
  let claude: ClaudeClient;
  let prompt: ReturnType<typeof makePromptMock>;

  beforeEach(() => {
    drive = makeDriveMock();
    claude = makeClaudeMock();
    prompt = makePromptMock();
    installCacheServiceStub();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-1: Happy path — every required GenerateResult field is present with
  //          the correct primitive type and the cost block matches CostBreakdown.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-1: happy path returns full GenerateResult shape', () => {
    const e = makeEvent(makeGenerateRequest());
    const out = doPost(e, { drive, claude, prompt });
    const body = parseOutput(out);

    if (!isObject(body) || body.ok !== true) {
      throw new Error(`expected ok:true result; got ${JSON.stringify(body)}`);
    }

    expect(typeof body.resumeMd).toBe('string');
    expect(typeof body.docUrl).toBe('string');
    expect(typeof body.jobFolderUrl).toBe('string');
    expect(typeof body.mdFileUrl).toBe('string');
    expect(typeof body.sheetRowUrl).toBe('string');
    expect(Array.isArray(body.missingSkills)).toBe(true);
    expect(Array.isArray(body.reframings)).toBe(true);
    expect(typeof body.modelUsed).toBe('string');

    // keywordCoverage block
    const cov = body.keywordCoverage;
    expect(isObject(cov)).toBe(true);
    if (!isObject(cov)) throw new Error('keywordCoverage was not an object');
    expect(Array.isArray(cov.matched)).toBe(true);
    expect(Array.isArray(cov.missing)).toBe(true);
    expect(typeof cov.rate).toBe('number');
    expect(cov.rate).toBeGreaterThanOrEqual(0);
    expect(cov.rate).toBeLessThanOrEqual(1);

    // cost block (CostBreakdown)
    const cost = body.cost;
    expect(isObject(cost)).toBe(true);
    if (!isObject(cost)) throw new Error('cost was not an object');
    expect(typeof cost.inputTokens).toBe('number');
    expect(typeof cost.outputTokens).toBe('number');
    expect(typeof cost.cacheReadTokens).toBe('number');
    expect(typeof cost.cacheCreationTokens).toBe('number');
    expect(typeof cost.totalUsd).toBe('number');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-2: researchSummary round-trips into the user message sent to Claude.
  //          The contract says generate accepts a pre-fetched company-research
  //          summary that is rendered under "=== Company Research ===".
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-2: researchSummary is rendered into the Claude user message', () => {
    const callSpy = vi.fn(() => makeClaudeResponse());
    claude = makeClaudeMock({ call: callSpy });

    const e = makeEvent(
      makeGenerateRequest({
        researchSummary: 'Acme makes industrial widgets in Ohio.',
      }),
    );
    doPost(e, { drive, claude, prompt });

    expect(callSpy).toHaveBeenCalledTimes(1);
    const passed = (callSpy.mock.calls[0] as unknown as [ClaudeRequest])[0];
    const userText = passed.messages[0].content;
    expect(userText).toContain('=== Company Research ===');
    expect(userText).toContain('Acme makes industrial widgets in Ohio.');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-3: Each required field — when omitted individually — produces a
  //          validation error with the canonical ApiErrorResponse shape.
  //          Required per validateGenerate(): jd, url, sourceFolderId,
  //          rulesFolderId, outputFolderId, sheetId, model.
  // ───────────────────────────────────────────────────────────────────────────
  it.each([
    'jd',
    'url',
    'sourceFolderId',
    'rulesFolderId',
    'outputFolderId',
    'sheetId',
    'model',
  ] as const)(
    'C-GEN-3[%s]: omitting required field yields validation error',
    (field) => {
      const base = makeGenerateRequest();
      const payload: Record<string, unknown> = { ...base };
      delete payload[field];

      const out = doPost(makeEvent(payload), { drive, claude, prompt });
      const body = parseOutput(out);

      expect(isApiError(body)).toBe(true);
      if (!isApiError(body)) return;
      expect(body.error.type).toBe('validation');
      expect(body.error.retryable).toBe(false);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-4: sourceFolderId pointing to a folder DriveOps reports missing →
  //          surfaces as a typed "drive" error. We make readSourceFiles throw
  //          with "Folder not found:" which Code.ts classifyError maps to a
  //          drive error.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-4: empty/missing source folder surfaces as drive error', () => {
    drive = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new Error('Folder not found: bad-source-folder-id');
      }),
    });

    const out = doPost(
      makeEvent(makeGenerateRequest({ sourceFolderId: 'bad-source-folder-id' })),
      { drive, claude, prompt },
    );
    const body = parseOutput(out);

    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;
    expect(body.error.type).toBe('drive');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-5: ApiErrorResponse shape invariant — type must belong to the
  //          documented union; retryable must be a boolean. Run on a trivially
  //          induced validation error.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-5: ApiErrorResponse error.type is a recognised union member; retryable is boolean', () => {
    const out = doPost(makeEvent({ action: 'generate' }), { drive, claude, prompt });
    const body = parseOutput(out) as ApiErrorResponse;
    expect(isApiError(body)).toBe(true);
    expect(ERROR_TYPES).toContain(body.error.type);
    expect(typeof body.error.retryable).toBe('boolean');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-6: cost.totalUsd is a number — never undefined, never negative,
  //          never NaN.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-6: cost.totalUsd is a finite, non-negative number', () => {
    const out = doPost(makeEvent(makeGenerateRequest()), { drive, claude, prompt });
    const body = parseOutput(out);

    if (!isObject(body) || body.ok !== true) {
      throw new Error(`expected ok:true generate result; got ${JSON.stringify(body)}`);
    }
    const cost = body.cost as Record<string, unknown>;
    const total = cost.totalUsd;

    expect(typeof total).toBe('number');
    expect(total).not.toBeUndefined();
    if (typeof total !== 'number') return;
    expect(Number.isNaN(total)).toBe(false);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-7: When the extension sends multiple toggles "on"
  //          (research+benchmark+critique), the generate response only carries
  //          GenerateResult fields — the other features run as separate
  //          actions and their result keys must NOT appear here.
  //          Asserting on the absence ensures the contract surface stays clean.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-7: multiple toggles ON still returns ONLY generate fields', () => {
    const out = doPost(
      makeEvent(
        makeGenerateRequest({
          toggles: {
            research: { enabled: true, model: MODEL },
            critique: { enabled: true, model: MODEL },
            autoRevise: { enabled: false, model: MODEL },
            multiVersion: { enabled: true, model: MODEL, count: 3 },
            coverLetter: { enabled: true, model: MODEL },
            verifyHooks: { enabled: true, model: MODEL },
          },
        }),
      ),
      { drive, claude, prompt },
    );
    const body = parseOutput(out);
    if (!isObject(body) || body.ok !== true) {
      throw new Error('expected ok:true');
    }

    // Forbidden v2-only keys that must NOT appear in a generate response:
    expect('critique' in body).toBe(false);
    expect('variants' in body).toBe(false);
    expect('coverLetterMd' in body).toBe(false);
    expect('verifications' in body).toBe(false);
    expect('summary' in body).toBe(false);
    expect('patterns' in body).toBe(false);

    // Required generate fields ARE present:
    expect('resumeMd' in body).toBe(true);
    expect('docUrl' in body).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-GEN-8: Unknown action returns validation error whose message lists every
  //          valid action so callers can discover the action vocabulary.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-GEN-8: unknown action validation message lists every VALID_ACTION', () => {
    const out = doPost(
      makeEvent({ action: 'reticulate_splines' }),
      { drive, claude, prompt },
    );
    const body = parseOutput(out);
    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;
    expect(body.error.type).toBe('validation');

    // Action vocabulary published by api-contract.ts ApiAction union.
    // The router must list ALL of these in its "Must be one of: ..." message
    // (or the extension can't surface a discoverable error to users).
    //
    // CONTRACT GOTCHA: ApiAction in api-contract.ts includes "create_drive_file"
    // (api-contract.ts line 23) but tests/contracts/_setup.ts's clients also
    // need to know — keep this list synced with the ApiAction union.
    const expected = [
      'generate',
      'finalize',
      'list_files',
      'write_file',
      'seed_defaults',
      'download_template',
      'upload_filled_docx',
      'create_drive_file',
      'research_company',
      'benchmark_role',
      'critique',
      'auto_revise',
      'cover_letter',
      'verify_cl_hooks',
      'multi_version',
      'ping',
    ];
    for (const action of expected) {
      expect(body.error.message).toContain(action);
    }
  });
});
