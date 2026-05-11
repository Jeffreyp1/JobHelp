/**
 * Tests for appsscript/src/handlers/verifyHooks.ts
 * TDD: tests written first, then implementation.
 *
 * Test IDs match E3 context doc:
 *   T1  happy path returns verifications array with >= 1 entry
 *   T2  verified entity has status "verified" and non-empty sources
 *   T3  unverified entity has status "unverified" and reason string
 *   T4  unverifiedCount matches count of status==="unverified" in array
 *   T5  missing coverLetterMd → validation error
 *   T6  Claude extraction failure → ok:false, retryable:true
 *   T7  individual search failure → entity "uncertain", overall ok:true
 *   T8  empty CL (no named entities) → verifications=[], unverifiedCount=0
 *   T9  cost.totalUsd accumulates across all calls
 *   T10 unverified entities have reason field set
 */

import { describe, it, expect, vi } from 'vitest';
import { handleVerifyClHooks, validateVerifyClHooks } from '../../src/handlers/verifyHooks.js';
import type { Deps } from '../../src/Code.js';
import type { VerifyClHooksRequest } from '../../src/types/api-contract.js';
import type { ClaudeResponse, ClaudeUsage } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODEL = 'claude-haiku-4-5-20251001';

const SAMPLE_CL = `Dear Hiring Manager,

I was excited to learn about Acme Corp's recent launch of the AcmeWidget SDK, which enables developers
to build real-time collaboration tools. Having spent the last three years working on the OpenCollab project
at StartupXYZ, I am eager to bring my distributed systems expertise to your Backend Lead role.

At StartupXYZ I led a team of 4 engineers to deliver the DataStream pipeline, achieving 50M events/day
with p99 latency under 120ms. We also won the TechCrunch Disrupt 2024 award for innovation in real-time
infrastructure. Dr. Sarah Chen, my mentor at MIT, published research that directly inspired our approach.

I would love to discuss how my work on AcmeWidget-compatible tooling aligns with your roadmap.
I am available for a call this week.`;

/** Mock entities that Claude extraction returns */
const MOCK_ENTITIES = [
  { entity: 'Acme Corp', entityType: 'company' },
  { entity: 'AcmeWidget SDK', entityType: 'product' },
  { entity: 'OpenCollab', entityType: 'program' },
  { entity: 'Dr. Sarah Chen', entityType: 'PI name' },
];

/** A verified search response JSON */
const VERIFIED_RESPONSE_JSON = JSON.stringify({
  status: 'verified',
  sources: [{ title: 'Acme Corp official site', url: 'https://acmecorp.com' }],
});

/** An unverified search response JSON */
const UNVERIFIED_RESPONSE_JSON = JSON.stringify({
  status: 'unverified',
  sources: [],
  reason: 'No web results found for this entity',
});

function makeUsage(overrides: Partial<ClaudeUsage> = {}): ClaudeUsage {
  return {
    input_tokens: 200,
    output_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...overrides,
  };
}

function makeExtractionResponse(entities: { entity: string; entityType: string }[]): ClaudeResponse {
  return {
    text: JSON.stringify(entities),
    stopReason: 'end_turn',
    usage: makeUsage(),
    model: MODEL,
  };
}

function makeSearchResponse(jsonText: string): ClaudeResponse {
  return {
    text: jsonText,
    stopReason: 'end_turn',
    usage: makeUsage({ input_tokens: 150, output_tokens: 80 }),
    model: MODEL,
  };
}

function makeRequest(overrides: Partial<VerifyClHooksRequest> = {}): VerifyClHooksRequest {
  return {
    action: 'verify_cl_hooks',
    coverLetterMd: SAMPLE_CL,
    model: MODEL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dep factories
// ---------------------------------------------------------------------------

/**
 * Build a Claude client mock where:
 *  - first call (entity extraction) returns extractionResponse
 *  - subsequent calls (per-entity search) return searchResponse
 */
function makeClaudeMock(
  extractionResponse: ClaudeResponse,
  searchResponse: ClaudeResponse = makeSearchResponse(VERIFIED_RESPONSE_JSON),
): Deps['claude'] {
  let callCount = 0;
  return {
    call: vi.fn(() => {
      callCount++;
      if (callCount === 1) return extractionResponse;
      return searchResponse;
    }),
  };
}

function makeDriveMock(): Deps['drive'] {
  return {
    readSourceFiles: vi.fn(),
    readRuleFiles: vi.fn(),
    writeOutput: vi.fn(),
    writeJobOutput: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    seedDefaults: vi.fn(),
    appendSheetRow: vi.fn(),
    updateSheetRow: vi.fn(),
    replaceDocContents: vi.fn(),
    exportDocAs: vi.fn(),
    downloadFileAsBase64: vi.fn(),
    uploadDocxFromBase64: vi.fn(),
    createFileInFolder: vi.fn(),
    createGoogleDoc: vi.fn(),
  } as Deps['drive'];
}

function makePromptMock(): Deps['prompt'] {
  return {
    composeSystemPrompt: vi.fn(() => ({
      type: 'text' as const,
      text: 'You are a helpful assistant.',
    })),
  };
}

function makeDeps(
  claudeOverride?: Deps['claude'],
): Deps {
  return {
    drive: makeDriveMock(),
    claude: claudeOverride ?? makeClaudeMock(makeExtractionResponse(MOCK_ENTITIES)),
    prompt: makePromptMock(),
  };
}

// ---------------------------------------------------------------------------
// validateVerifyClHooks
// ---------------------------------------------------------------------------

describe('validateVerifyClHooks', () => {
  it('T5: missing coverLetterMd → validation error', () => {
    const result = validateVerifyClHooks({ action: 'verify_cl_hooks', model: MODEL });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('coverLetterMd');
  });

  it('empty coverLetterMd → validation error', () => {
    const result = validateVerifyClHooks({
      action: 'verify_cl_hooks',
      coverLetterMd: '',
      model: MODEL,
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
  });

  it('missing model → validation error', () => {
    const result = validateVerifyClHooks({
      action: 'verify_cl_hooks',
      coverLetterMd: 'some cover letter',
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('model');
  });

  it('valid fields → returns null', () => {
    const result = validateVerifyClHooks({
      action: 'verify_cl_hooks',
      coverLetterMd: 'some cover letter text',
      model: MODEL,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleVerifyClHooks
// ---------------------------------------------------------------------------

describe('handleVerifyClHooks', () => {
  it('T1: happy path returns verifications array with >= 1 entry', () => {
    const deps = makeDeps();
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.verifications)).toBe(true);
    expect(result.verifications.length).toBeGreaterThan(0);
  });

  it('T2: verified entity has status "verified" and non-empty sources', () => {
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([{ entity: 'Acme Corp', entityType: 'company' }]),
        makeSearchResponse(VERIFIED_RESPONSE_JSON),
      ),
    );
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verified = result.verifications.find(v => v.status === 'verified');
    expect(verified).toBeDefined();
    expect(verified!.sources.length).toBeGreaterThan(0);
    expect(typeof verified!.sources[0].title).toBe('string');
    expect(typeof verified!.sources[0].url).toBe('string');
  });

  it('T3: unverified entity has status "unverified" and reason string', () => {
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([{ entity: 'FakeProduct XYZ', entityType: 'product' }]),
        makeSearchResponse(UNVERIFIED_RESPONSE_JSON),
      ),
    );
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unverified = result.verifications.find(v => v.status === 'unverified');
    expect(unverified).toBeDefined();
    expect(typeof unverified!.reason).toBe('string');
    expect(unverified!.reason!.length).toBeGreaterThan(0);
  });

  it('T4: unverifiedCount matches count of status==="unverified" in array', () => {
    // 2 entities: first verified, second unverified
    let searchCallCount = 0;
    const deps: Deps = {
      drive: makeDriveMock(),
      claude: {
        call: vi.fn(() => {
          searchCallCount++;
          if (searchCallCount === 1) {
            return makeExtractionResponse([
              { entity: 'Acme Corp', entityType: 'company' },
              { entity: 'FakeThing', entityType: 'product' },
            ]);
          }
          if (searchCallCount === 2) return makeSearchResponse(VERIFIED_RESPONSE_JSON);
          return makeSearchResponse(UNVERIFIED_RESPONSE_JSON);
        }),
      },
      prompt: makePromptMock(),
    };
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedUnverified = result.verifications.filter(v => v.status === 'unverified').length;
    expect(result.unverifiedCount).toBe(expectedUnverified);
  });

  it('T6: Claude extraction failure → ok:false, retryable:true', () => {
    const deps: Deps = {
      drive: makeDriveMock(),
      claude: {
        call: vi.fn(() => {
          throw new ClaudeApiError('server', 500, 'Claude API unavailable');
        }),
      },
      prompt: makePromptMock(),
    };
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.type).toBe('server');
  });

  it('T7: individual search failure → entity "uncertain", overall ok:true', () => {
    let callCount = 0;
    const deps: Deps = {
      drive: makeDriveMock(),
      claude: {
        call: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return makeExtractionResponse([{ entity: 'SomeEntity', entityType: 'product' }]);
          }
          // Search call throws
          throw new Error('Search network failure');
        }),
      },
      prompt: makePromptMock(),
    };
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifications.length).toBe(1);
    expect(result.verifications[0].status).toBe('uncertain');
    expect(typeof result.verifications[0].reason).toBe('string');
  });

  it('T8: empty CL (no named entities) → verifications=[], unverifiedCount=0', () => {
    const deps = makeDeps(
      makeClaudeMock(makeExtractionResponse([])),
    );
    const req = makeRequest({ coverLetterMd: 'Dear Hiring Manager, please consider me. Sincerely.' });
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifications).toEqual([]);
    expect(result.unverifiedCount).toBe(0);
  });

  it('T9: cost.totalUsd accumulates across all calls', () => {
    // extraction call: 200in+100out=0.0015 USD; each search: 150in+80out
    const entities = [
      { entity: 'Acme Corp', entityType: 'company' },
      { entity: 'AcmeWidget', entityType: 'product' },
    ];
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse(entities),
        makeSearchResponse(VERIFIED_RESPONSE_JSON),
      ),
    );
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 total calls (1 extraction + 2 searches), all have tokens → totalUsd > 0
    expect(result.cost.totalUsd).toBeGreaterThan(0);
    // Accumulated tokens: inputTokens = 200 + 150 + 150 = 500
    expect(result.cost.inputTokens).toBeGreaterThanOrEqual(400);
  });

  it('T10: unverified entities have reason field set', () => {
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([
          { entity: 'FakeOrg', entityType: 'company' },
          { entity: 'FakeProduct', entityType: 'product' },
        ]),
        makeSearchResponse(UNVERIFIED_RESPONSE_JSON),
      ),
    );
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unverifiedEntities = result.verifications.filter(v => v.status === 'unverified');
    expect(unverifiedEntities.length).toBeGreaterThan(0);
    for (const v of unverifiedEntities) {
      expect(typeof v.reason).toBe('string');
      expect(v.reason!.length).toBeGreaterThan(0);
    }
  });

  it('entity extraction returns non-JSON → ok:false, retryable:true', () => {
    const deps = makeDeps(
      makeClaudeMock({
        text: 'I cannot extract entities from this text.',
        stopReason: 'end_turn',
        usage: makeUsage(),
        model: MODEL,
      }),
    );
    const req = makeRequest();
    const result = handleVerifyClHooks(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
  });

  it('entity data shape is correct (entity, entityType, status, sources)', () => {
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([{ entity: 'Acme Corp', entityType: 'company' }]),
        makeSearchResponse(VERIFIED_RESPONSE_JSON),
      ),
    );
    const result = handleVerifyClHooks(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v = result.verifications[0];
    expect(typeof v.entity).toBe('string');
    expect(typeof v.entityType).toBe('string');
    expect(['verified', 'unverified', 'uncertain']).toContain(v.status);
    expect(Array.isArray(v.sources)).toBe(true);
  });

  it('search response non-JSON → entity marked uncertain, continues', () => {
    let callCount = 0;
    const deps: Deps = {
      drive: makeDriveMock(),
      claude: {
        call: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return makeExtractionResponse([{ entity: 'Acme Corp', entityType: 'company' }]);
          }
          // Search returns malformed JSON
          return {
            text: 'I verified it is real.',  // not JSON
            stopReason: 'end_turn',
            usage: makeUsage(),
            model: MODEL,
          };
        }),
      },
      prompt: makePromptMock(),
    };
    const result = handleVerifyClHooks(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifications[0].status).toBe('uncertain');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sheet column back-fill (B1 / B6 — updateSheetRow integration)
  // ─────────────────────────────────────────────────────────────────────────

  it('sheetId + rowUrl provided → updateSheetRow called once with verifyHookUnverifiedCount', () => {
    // Use two entities, both unverified → unverifiedCount=2
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([
          { entity: 'FakeOrg', entityType: 'company' },
          { entity: 'FakeProduct', entityType: 'product' },
        ]),
        makeSearchResponse(UNVERIFIED_RESPONSE_JSON),
      ),
    );
    const result = handleVerifyClHooks(
      deps,
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deps.drive.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledWith(
      'sheet-abc',
      'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      { verifyHookUnverifiedCount: result.unverifiedCount },
    );
  });

  it('sheetId/rowUrl omitted → updateSheetRow NOT called', () => {
    const deps = makeDeps();
    handleVerifyClHooks(deps, makeRequest()); // no sheetId/rowUrl
    expect(deps.drive.updateSheetRow).not.toHaveBeenCalled();
  });

  it('updateSheetRow throwing does NOT fail handler — returns ok:true (graceful degradation)', () => {
    const deps = makeDeps(
      makeClaudeMock(
        makeExtractionResponse([{ entity: 'Acme Corp', entityType: 'company' }]),
        makeSearchResponse(VERIFIED_RESPONSE_JSON),
      ),
    );
    (deps.drive.updateSheetRow as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('sheet quota');
    });
    const result = handleVerifyClHooks(
      deps,
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    expect(result.ok).toBe(true);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledOnce();
  });

  it('empty-entities short-circuit also calls updateSheetRow with count=0 when sheet info given', () => {
    const deps = makeDeps(
      makeClaudeMock(makeExtractionResponse([])),
    );
    const result = handleVerifyClHooks(
      deps,
      makeRequest({
        coverLetterMd: 'Dear Hiring Manager, please consider me. Sincerely.',
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unverifiedCount).toBe(0);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledWith(
      'sheet-abc',
      'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      { verifyHookUnverifiedCount: 0 },
    );
  });
});
