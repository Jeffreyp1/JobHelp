/**
 * Tests for appsscript/src/handlers/critique.ts
 *
 * Per E2 plan, critique:
 *   - Accepts {resumeMd, jd, jobInsights?, jobFolderId?, model}
 *   - Returns 8 dimension scores + tiered improvements + totalScore + cost
 *   - When jobFolderId provided, writes critique.md to drive
 *   - Validates required fields, gracefully handles Claude failures + JSON parse errors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCritique, validateCritique } from '../../src/handlers/critique.js';
import type { Deps } from '../../src/Code.js';
import type { CritiqueRequest } from '../../src/types/api-contract.js';
import type { ClaudeClient, ClaudeRequest, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { DriveOps } from '../../src/types/drive-ops.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const VALID_CRITIQUE_JSON = JSON.stringify({
  scores: [
    { dimension: 'keyword_coverage', score: 8, weight: 0.2, notes: 'Good keyword coverage' },
    { dimension: 'bullet_impact', score: 7, weight: 0.2, notes: 'Bullets are mostly impact-focused' },
    { dimension: 'structure', score: 9, weight: 0.15, notes: 'Clean structure' },
    { dimension: 'formatting', score: 8, weight: 0.1, notes: 'Consistent formatting' },
    { dimension: 'relevance', score: 7, weight: 0.15, notes: 'Mostly relevant' },
    { dimension: 'truthfulness', score: 10, weight: 0.05, notes: 'No fabrications detected' },
    { dimension: 'conciseness', score: 6, weight: 0.1, notes: 'Slightly verbose in spots' },
    { dimension: 'ats_friendliness', score: 9, weight: 0.05, notes: 'ATS-friendly format' },
  ],
  improvements: [
    { tier: 1, text: 'Add quantified metric to bullet 2', expectedDelta: 0.15 },
    { tier: 2, text: 'Tighten the summary paragraph', expectedDelta: 0.05 },
    { tier: 2, text: 'Move skills section above experience', expectedDelta: 0.04 },
    { tier: 3, text: 'Use stronger verbs in section 3', expectedDelta: 0.02 },
  ],
});

function makeClaudeResponse(text = VALID_CRITIQUE_JSON): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 800,
      output_tokens: 400,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: 'claude-haiku-4-5-20251001',
  };
}

function makeClaudeMock(overrides: Partial<ClaudeClient> = {}): ClaudeClient {
  return {
    call: vi.fn(() => makeClaudeResponse()),
    ...overrides,
  };
}

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  return {
    readSourceFiles: vi.fn(),
    readRuleFiles: vi.fn(() => []),
    writeOutput: vi.fn(() => ({
      docUrl: 'https://docs.google.com/document/d/critique-doc/edit',
      docId: 'critique-doc',
    })),
    writeJobOutput: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(() => ({ updatedAt: 1_700_000_000_000 })),
    seedDefaults: vi.fn(),
    appendSheetRow: vi.fn(),
    updateSheetRow: vi.fn(),
    replaceDocContents: vi.fn(),
    exportDocAs: vi.fn(),
    downloadFileAsBase64: vi.fn(),
    uploadDocxFromBase64: vi.fn(),
    createFileInFolder: vi.fn(),
    createGoogleDoc: vi.fn(),
    ...overrides,
  } as DriveOps;
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    drive: makeDriveMock(),
    claude: makeClaudeMock(),
    prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CritiqueRequest> = {}): CritiqueRequest {
  return {
    action: 'critique',
    resumeMd: '# Resume\n\n## Experience\n\n- Built things',
    jd: 'We need a Python developer.',
    jobInsights: null,
    jobFolderId: null,
    model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCritique
// ---------------------------------------------------------------------------

describe('validateCritique', () => {
  it('returns null for valid input', () => {
    const result = validateCritique({
      resumeMd: '# Resume',
      jd: 'JD',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(result).toBeNull();
  });

  it('T6: missing resumeMd returns validation error', () => {
    const result = validateCritique({ jd: 'JD', model: 'm' });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
  });

  it('T6b: empty resumeMd returns validation error', () => {
    const result = validateCritique({ resumeMd: '', jd: 'JD', model: 'm' });
    expect(result?.error.type).toBe('validation');
  });

  it('T7: missing jd returns validation error', () => {
    const result = validateCritique({ resumeMd: '# r', model: 'm' });
    expect(result?.error.type).toBe('validation');
  });

  it('missing model returns validation error', () => {
    const result = validateCritique({ resumeMd: '# r', jd: 'JD' });
    expect(result?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// handleCritique
// ---------------------------------------------------------------------------

describe('handleCritique', () => {
  let deps: Deps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it('T1: happy path returns 8 CritiqueScore objects', () => {
    const result = handleCritique(deps, makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.scores.length).toBe(8);
    const dims = result.scores.map(s => s.dimension);
    expect(dims).toContain('keyword_coverage');
    expect(dims).toContain('bullet_impact');
    expect(dims).toContain('ats_friendliness');
  });

  it('T2: totalScore is weighted average of scores', () => {
    const result = handleCritique(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    // 8*0.2 + 7*0.2 + 9*0.15 + 8*0.1 + 7*0.15 + 10*0.05 + 6*0.1 + 9*0.05
    // = 1.6 + 1.4 + 1.35 + 0.8 + 1.05 + 0.5 + 0.6 + 0.45 = 7.75
    const expected = result.scores.reduce((s, x) => s + x.score * x.weight, 0);
    expect(Math.abs(result.totalScore - expected)).toBeLessThan(0.01);
  });

  it('T3: improvements has at least 1 tier-1 entry', () => {
    const result = handleCritique(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    expect(result.improvements.some(i => i.tier === 1)).toBe(true);
  });

  it('T3b: improvements include tiered numbers and expectedDelta', () => {
    const result = handleCritique(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    for (const imp of result.improvements) {
      expect([1, 2, 3]).toContain(imp.tier);
      expect(typeof imp.expectedDelta).toBe('number');
    }
  });

  it('T4: jobFolderId=null → critiqueDocUrl is null and drive not called', () => {
    const result = handleCritique(deps, makeRequest({ jobFolderId: null }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.critiqueDocUrl).toBeNull();
    expect(deps.drive.writeOutput).not.toHaveBeenCalled();
  });

  it('T5: jobFolderId provided → critiqueDocUrl is a non-empty string and drive called', () => {
    const result = handleCritique(deps, makeRequest({ jobFolderId: 'job-folder-id' }));
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.critiqueDocUrl).toBe('string');
    expect(result.critiqueDocUrl?.length ?? 0).toBeGreaterThan(0);
    expect(deps.drive.writeOutput).toHaveBeenCalled();
  });

  it('T8: Claude failure returns retryable error', () => {
    const claude = makeClaudeMock({
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'rate limited');
      }),
    });
    const result = handleCritique({ ...deps, claude }, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.retryable).toBe(true);
  });

  it('T9: malformed Claude JSON returns ok:false with type=server', () => {
    const claude = makeClaudeMock({ call: vi.fn(() => makeClaudeResponse('not valid json {{{')) });
    const result = handleCritique({ ...deps, claude }, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
  });

  it('T10: cost.totalUsd is a positive number', () => {
    const result = handleCritique(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });

  it('passes resumeMd and jd to Claude in user message', () => {
    const callMock = vi.fn<(req: ClaudeRequest) => ClaudeResponse>(() => makeClaudeResponse());
    const claude: ClaudeClient = { call: callMock };
    handleCritique({ ...deps, claude }, makeRequest({
      resumeMd: '# UNIQUE_RESUME_MARKER',
      jd: 'UNIQUE_JD_MARKER',
    }));
    expect(callMock).toHaveBeenCalledOnce();
    const callArgs = callMock.mock.calls[0]?.[0];
    if (!callArgs) throw new Error('expected callMock to have been called');
    expect(callArgs.messages[0].content).toContain('UNIQUE_RESUME_MARKER');
    expect(callArgs.messages[0].content).toContain('UNIQUE_JD_MARKER');
  });

  it('drive write failure is non-fatal: returns ok:true with critiqueDocUrl=null', () => {
    const drive = makeDriveMock({
      writeOutput: vi.fn(() => { throw new Error('quota exceeded'); }),
    });
    const result = handleCritique({ ...deps, drive }, makeRequest({ jobFolderId: 'job-folder-id' }));
    // Per E2 spec: drive errors degrade, not fatal
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.critiqueDocUrl).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sheet column back-fill (B1 / B6 — updateSheetRow integration)
  // ─────────────────────────────────────────────────────────────────────────

  it('sheetId + rowUrl provided → updateSheetRow called once with critiqueScore', () => {
    const drive = makeDriveMock();
    const result = handleCritique(
      { ...deps, drive },
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(drive.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(drive.updateSheetRow).toHaveBeenCalledWith(
      'sheet-abc',
      'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      { critiqueScore: result.totalScore },
    );
  });

  it('sheetId/rowUrl omitted → updateSheetRow NOT called', () => {
    const drive = makeDriveMock();
    handleCritique({ ...deps, drive }, makeRequest()); // no sheetId/rowUrl
    expect(drive.updateSheetRow).not.toHaveBeenCalled();
  });

  it('updateSheetRow throwing does NOT fail handler — returns ok:true (graceful degradation)', () => {
    const drive = makeDriveMock({
      updateSheetRow: vi.fn(() => { throw new Error('sheet quota'); }),
    });
    const result = handleCritique(
      { ...deps, drive },
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    expect(result.ok).toBe(true);
    expect(drive.updateSheetRow).toHaveBeenCalledOnce();
  });
});
