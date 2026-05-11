/**
 * @file tests/contracts/errors.contract.test.ts
 *
 * BLACK-BOX contract tests for the error envelope across actions. The
 * `ApiErrorResponse` shape is `{ ok: false; error: { type, message, retryable } }`
 * — every error path must comply.
 *
 * These tests intentionally exercise multiple actions; we don't care which
 * handler the error came from, only that the wire format is uniform.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doPost } from '../../appsscript/src/Code.js';
import type { DriveOps } from '../../appsscript/src/types/drive-ops.js';
import type { ClaudeClient } from '../../appsscript/src/types/claude-api.js';
import { ClaudeApiError } from '../../appsscript/src/types/claude-api.js';
import type {
  ApiErrorResponse,
  GenerateRequest,
} from '../../appsscript/src/types/api-contract.js';
import {
  ERROR_TYPES,
  ErrorType,
  JOB_FOLDER_ID,
  MODEL,
  OUTPUT_FOLDER_ID,
  RETRYABLE_ERROR_TYPES,
  RULES_FOLDER_ID,
  SHEET_ID,
  SOURCE_FOLDER_ID,
  installCacheServiceStub,
  isApiError,
  isObject,
  makeClaudeMock,
  makeDriveMock,
  makeEvent,
  makePromptMock,
  parseOutput,
} from './_setup.js';

function makeGenerateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    action: 'generate',
    jd: 'jd',
    company: 'Acme',
    role: 'Engineer',
    url: 'https://example.com/job',
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

describe('contract: ApiErrorResponse envelope', () => {
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
  // C-ERR-1: An error response carries exactly the three error fields
  //          (type, message, retryable) inside `error`, alongside `ok: false`.
  //          No "stray" top-level keys and no extra keys inside `error`.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-1: error envelope has exactly {ok:false, error:{type, message, retryable}} — no extras', () => {
    const out = doPost(makeEvent({ action: 'generate' }), { drive, claude, prompt });
    const body = parseOutput(out);

    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;

    // Exactly { ok, error } at the top level
    const topKeys = Object.keys(body).sort();
    expect(topKeys).toEqual(['error', 'ok']);

    // Exactly { type, message, retryable } inside error
    const errKeys = Object.keys(body.error).sort();
    expect(errKeys).toEqual(['message', 'retryable', 'type']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-2: error.type values are stable members of the documented union.
  //          We trigger every typeable error and confirm membership.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-2: error.type union is exactly the documented set', () => {
    // The documented union: auth | rate_limit | server | validation | drive | config | other
    expect([...ERROR_TYPES].sort()).toEqual(
      ['auth', 'config', 'drive', 'other', 'rate_limit', 'server', 'validation'].sort(),
    );

    // Each emitted error.type belongs to the union — sample several paths.
    const samples: ApiErrorResponse[] = [];

    // validation
    samples.push(
      parseOutput(
        doPost(makeEvent({ action: 'generate' }), { drive, claude, prompt }),
      ) as ApiErrorResponse,
    );

    // drive
    const driveErr = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new Error('Folder not found: x');
      }),
    });
    samples.push(
      parseOutput(
        doPost(makeEvent(makeGenerateRequest()), { drive: driveErr, claude, prompt }),
      ) as ApiErrorResponse,
    );

    // other (unknown error class)
    const otherErr = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new TypeError('weirdness');
      }),
    });
    samples.push(
      parseOutput(
        doPost(makeEvent(makeGenerateRequest()), { drive: otherErr, claude, prompt }),
      ) as ApiErrorResponse,
    );

    // rate_limit (via ClaudeApiError)
    const rateClaude = makeClaudeMock({
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'Too many requests', 30);
      }),
    });
    samples.push(
      parseOutput(
        doPost(makeEvent(makeGenerateRequest()), {
          drive: makeDriveMock(),
          claude: rateClaude,
          prompt,
        }),
      ) as ApiErrorResponse,
    );

    for (const s of samples) {
      expect(isApiError(s)).toBe(true);
      if (!isApiError(s)) continue;
      expect(ERROR_TYPES).toContain(s.error.type);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-3: retryable is true ONLY for rate_limit and server errors.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-3: retryable is true iff error.type ∈ {rate_limit, server}', () => {
    // Build pairs of (induced error → expected retryable)
    const probes: Array<{
      label: string;
      run: () => ApiErrorResponse;
      expectedType: ErrorType;
      expectedRetryable: boolean;
    }> = [
      {
        label: 'validation (missing action)',
        run: () =>
          parseOutput(
            doPost(makeEvent({}), { drive, claude, prompt }),
          ) as ApiErrorResponse,
        expectedType: 'validation',
        expectedRetryable: false,
      },
      {
        label: 'drive (folder not found)',
        run: () =>
          parseOutput(
            doPost(
              makeEvent(makeGenerateRequest({ sourceFolderId: 'bad' })),
              {
                drive: makeDriveMock({
                  readSourceFiles: vi.fn(() => {
                    throw new Error('Folder not found: bad');
                  }),
                }),
                claude,
                prompt,
              },
            ),
          ) as ApiErrorResponse,
        expectedType: 'drive',
        expectedRetryable: false,
      },
      {
        label: 'other (unknown error)',
        run: () =>
          parseOutput(
            doPost(makeEvent(makeGenerateRequest()), {
              drive: makeDriveMock({
                readSourceFiles: vi.fn(() => {
                  throw new TypeError('not a known shape');
                }),
              }),
              claude,
              prompt,
            }),
          ) as ApiErrorResponse,
        expectedType: 'other',
        expectedRetryable: false,
      },
      {
        label: 'rate_limit (ClaudeApiError)',
        run: () =>
          parseOutput(
            doPost(makeEvent(makeGenerateRequest()), {
              drive: makeDriveMock(),
              claude: makeClaudeMock({
                call: vi.fn(() => {
                  throw new ClaudeApiError('rate_limit', 429, 'rl', 30);
                }),
              }),
              prompt,
            }),
          ) as ApiErrorResponse,
        expectedType: 'rate_limit',
        expectedRetryable: true,
      },
      {
        label: 'server (ClaudeApiError)',
        run: () =>
          parseOutput(
            doPost(makeEvent(makeGenerateRequest()), {
              drive: makeDriveMock(),
              claude: makeClaudeMock({
                call: vi.fn(() => {
                  throw new ClaudeApiError('server', 500, 'oops');
                }),
              }),
              prompt,
            }),
          ) as ApiErrorResponse,
        expectedType: 'server',
        expectedRetryable: true,
      },
      {
        label: 'auth (ClaudeApiError)',
        run: () =>
          parseOutput(
            doPost(makeEvent(makeGenerateRequest()), {
              drive: makeDriveMock(),
              claude: makeClaudeMock({
                call: vi.fn(() => {
                  throw new ClaudeApiError('auth', 401, 'bad api key');
                }),
              }),
              prompt,
            }),
          ) as ApiErrorResponse,
        expectedType: 'auth',
        expectedRetryable: false,
      },
    ];

    for (const probe of probes) {
      const body = probe.run();
      expect(isApiError(body), `[${probe.label}] not an ApiErrorResponse`).toBe(true);
      if (!isApiError(body)) continue;
      expect(body.error.type, `[${probe.label}] wrong type`).toBe(probe.expectedType);
      expect(body.error.retryable, `[${probe.label}] wrong retryable`).toBe(
        probe.expectedRetryable,
      );

      // Cross-invariant: retryable=true ⇒ type ∈ {rate_limit, server}.
      if (body.error.retryable) {
        expect(RETRYABLE_ERROR_TYPES).toContain(body.error.type as ErrorType);
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-4: A non-2xx Claude response → ClaudeApiError → mapped to the
  //          response error.type the class declared (auth/rate_limit/etc.).
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-4: ClaudeApiError → response error.{type,retryable} mirror the thrown class', () => {
    const tests: Array<{
      claudeType: 'auth' | 'rate_limit' | 'server' | 'validation';
      expectedType: ErrorType;
      expectedRetryable: boolean;
    }> = [
      { claudeType: 'auth', expectedType: 'auth', expectedRetryable: false },
      { claudeType: 'rate_limit', expectedType: 'rate_limit', expectedRetryable: true },
      { claudeType: 'server', expectedType: 'server', expectedRetryable: true },
      // validation flowing back through Code.classifyError stays "validation"
      { claudeType: 'validation', expectedType: 'validation', expectedRetryable: false },
    ];

    for (const t of tests) {
      const claudeMock = makeClaudeMock({
        call: vi.fn(() => {
          throw new ClaudeApiError(t.claudeType, 500, `induced ${t.claudeType}`);
        }),
      });
      const out = doPost(
        makeEvent(makeGenerateRequest()),
        { drive: makeDriveMock(), claude: claudeMock, prompt },
      );
      const body = parseOutput(out);
      expect(isApiError(body), `[${t.claudeType}] not an error envelope`).toBe(true);
      if (!isApiError(body)) continue;
      expect(body.error.type, `[${t.claudeType}] wrong type`).toBe(t.expectedType);
      expect(body.error.retryable, `[${t.claudeType}] wrong retryable`).toBe(
        t.expectedRetryable,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-5: Thrown Errors from inside handlers are caught and returned as
  //          ApiErrorResponse — NOT propagated as an exception (which Apps
  //          Script would surface as a 500 to the extension).
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-5: handler throws are caught and mapped — doPost never throws', () => {
    const explodingDrive = makeDriveMock({
      writeJobOutput: vi.fn(() => {
        throw new Error('exploding writeJobOutput');
      }),
    });

    // doPost itself must not throw — it MUST swallow the error and return
    // a typed envelope. If it throws, this assertion fails immediately.
    let out: GoogleAppsScript.Content.TextOutput;
    expect(() => {
      out = doPost(makeEvent(makeGenerateRequest()), {
        drive: explodingDrive,
        claude,
        prompt,
      });
    }).not.toThrow();

    // And the returned body is an ApiErrorResponse, not a server-error
    // wrapper or a stack trace string.
    const body = parseOutput(out!);
    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;
    expect(ERROR_TYPES).toContain(body.error.type);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-5b: CONTRACT BUG SURFACED.
  //
  // critique.ts and autoRevise.ts re-map an incoming ClaudeApiError type via:
  //   `type: err.errorType === 'auth' ? 'auth' :
  //          err.errorType === 'validation' ? 'validation' : 'server'`
  //
  // This silently downgrades a `rate_limit` ClaudeApiError into a wire-level
  // `server` error, even though retryable=true is preserved (ClaudeApiError's
  // getter still says retryable, by coincidence — both rate_limit and server
  // are retryable). The bug: the extension can no longer distinguish a true
  // 5xx from a 429 — it loses the ability to apply rate-limit backoff vs
  // generic retry.
  //
  // The contract (api-contract.ts ApiError.type union) explicitly includes
  // 'rate_limit' as a first-class member, and other handlers
  // (research.ts:189-196, benchmark.ts:172-180, coverLetter.ts:253-262)
  // correctly pass `err.errorType` through. critique + autoRevise are the
  // outliers.
  //
  // Source: appsscript/src/handlers/critique.ts:281
  //         appsscript/src/handlers/autoRevise.ts:382
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-5b: critique propagates rate_limit ClaudeApiError as type="rate_limit", not "server"', () => {
    const rateClaude = makeClaudeMock({
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'Rate limit exceeded', 30);
      }),
    });

    const out = doPost(
      makeEvent({
        action: 'critique',
        resumeMd: '# Resume',
        jd: 'Looking for engineer',
        jobInsights: null,
        jobFolderId: null,
        model: MODEL,
      }),
      { drive: makeDriveMock(), claude: rateClaude, prompt },
    );
    const body = parseOutput(out) as ApiErrorResponse;
    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;
    // The wire-level type must match the original Claude error type. Anything
    // else means the rate-limit signal was silently re-classified.
    expect(body.error.type).toBe('rate_limit');
    expect(body.error.retryable).toBe(true);
  });

  it('C-ERR-5c: auto_revise propagates rate_limit ClaudeApiError as type="rate_limit", not "server"', () => {
    const rateClaude = makeClaudeMock({
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'Rate limit exceeded', 30);
      }),
    });

    const out = doPost(
      makeEvent({
        action: 'auto_revise',
        currentMarkdown: '# Resume\n- Bullet',
        targetScope: { kind: 'whole-resume' },
        instruction: 'Polish',
        model: MODEL,
      }),
      { drive: makeDriveMock(), claude: rateClaude, prompt },
    );
    const body = parseOutput(out) as ApiErrorResponse;
    expect(isApiError(body)).toBe(true);
    if (!isApiError(body)) return;
    expect(body.error.type).toBe('rate_limit');
    expect(body.error.retryable).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C-ERR-6: jsonOutput wraps the JSON as a TextOutput whose `.getContent()`
  //          returns the same JSON string used internally. This is the wire
  //          contract Apps Script enforces — the extension only ever sees
  //          `getContent()`.
  // ───────────────────────────────────────────────────────────────────────────
  it('C-ERR-6: TextOutput.getContent() returns parseable JSON for both ok and error responses', () => {
    // Error path
    const errOut = doPost(makeEvent({ action: 'generate' }), { drive, claude, prompt });
    const errAccessor = errOut as unknown as { getContent?: () => string };
    expect(typeof errAccessor.getContent).toBe('function');
    if (typeof errAccessor.getContent !== 'function') return;
    const errContent = errAccessor.getContent();
    expect(typeof errContent).toBe('string');
    const errBody = JSON.parse(errContent);
    expect(isApiError(errBody)).toBe(true);

    // Happy path
    const okOut = doPost(makeEvent(makeGenerateRequest()), { drive, claude, prompt });
    const okAccessor = okOut as unknown as { getContent?: () => string };
    expect(typeof okAccessor.getContent).toBe('function');
    if (typeof okAccessor.getContent !== 'function') return;
    const okContent = okAccessor.getContent();
    expect(typeof okContent).toBe('string');
    const okBody = JSON.parse(okContent);
    if (!isObject(okBody)) throw new Error('okBody not an object');
    expect(okBody.ok).toBe(true);
  });
});
