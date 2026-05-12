/**
 * Tests for appsscript/src/handlers/coverLetter.ts
 * TDD: tests written first, then implementation.
 *
 * Test IDs match E3 context doc:
 *   T1  happy path returns coverLetterMd (non-empty string)
 *   T2  CL has >= 3 paragraphs (mocked 3-paragraph Claude response)
 *   T3  docUrl and mdFileUrl are non-empty strings
 *   T4  missing resumeMd → validation error
 *   T5  missing jd → validation error
 *   T6  missing jobFolderId → validation error
 *   T7  Claude failure → ok:false, retryable:true
 *   T8  drive write failure → ok:false, type:"drive"
 *   T9  cost.totalUsd is a positive number
 *   T10 cover letter includes company name when provided
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCoverLetter, validateCoverLetter } from '../../src/handlers/coverLetter.js';
import type { Deps } from '../../src/Code.js';
import type {
  CoverLetterRequest,
  CoverLetterResult,
  ApiResult,
} from '../../src/types/api-contract.js';
import type { ClaudeResponse, ClaudeUsage } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { FileEntry, ConcatenatedSourceMaterials } from '../../src/types/drive-ops.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SOURCE_FOLDER_ID = 'source-folder-id';
const RULES_FOLDER_ID = 'rules-folder-id';
const JOB_FOLDER_ID = 'job-folder-id';
const MODEL = 'claude-haiku-4-5-20251001';

/** A 3-paragraph CL with ~270 words — satisfies HOOK/EVIDENCE/CLOSING */
const MOCK_CL_TEXT = [
  `I recently read about Acme Corp's launch of the AcmeWidget platform, which directly parallels my work ` +
  `building distributed systems at scale. As a Senior Software Engineer applying for the Backend Lead role, ` +
  `I am excited by the technical challenges your team is tackling. Your focus on developer experience aligns ` +
  `closely with the tooling infrastructure I built at my previous employer.`,

  `At StartupXYZ, I led the redesign of a data pipeline serving 50 million daily events, reducing p99 latency ` +
  `from 800 ms to 120 ms — a 6x improvement that unlocked new product capabilities. I also architected a ` +
  `multi-region failover system that achieved 99.99% uptime across two cloud providers, eliminating a ` +
  `single point of failure that had caused three production incidents the prior year. Both projects required ` +
  `deep collaboration with product and infrastructure teams, skills I would bring directly to Acme Corp's ` +
  `platform team.`,

  `I would bring a track record of shipping reliable, high-throughput systems to Acme Corp's infrastructure ` +
  `goals. I'd welcome a conversation about the Backend Lead role — I'm available for a call any time ` +
  `this week and can share code samples or design documents on request.`,
].join('\n\n');

function makeClaudeUsage(overrides: Partial<ClaudeUsage> = {}): ClaudeUsage {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...overrides,
  };
}

function makeClaudeResponse(text = MOCK_CL_TEXT): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: makeClaudeUsage(),
    model: MODEL,
  };
}

function makeRuleFile(name: string): FileEntry {
  return {
    name,
    fileId: `file-${name}`,
    contents: `# ${name}\nrule content`,
    tokens: 10,
    lastModifiedAt: 1_700_000_000_000,
    loadBearing: false,
  };
}

function makeSourceMaterials(): ConcatenatedSourceMaterials {
  return {
    text: '=== resume.md ===\nI am a software engineer with 5 years of experience.',
    files: [
      {
        name: 'resume.md',
        fileId: 'file-resume',
        contents: 'I am a software engineer.',
        tokens: 10,
        lastModifiedAt: 1_700_000_000_000,
      },
    ],
    totalTokens: 10,
  };
}

function makeRequest(overrides: Partial<CoverLetterRequest> = {}): CoverLetterRequest {
  return {
    action: 'cover_letter',
    resumeMd: '# Jane Doe\n\nSoftware engineer with 5 years of experience.',
    jd: 'We are looking for a Backend Lead at Acme Corp.',
    company: 'Acme Corp',
    role: 'Backend Lead',
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    jobFolderId: JOB_FOLDER_ID,
    model: MODEL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dep mock factories
// ---------------------------------------------------------------------------

function makeDriveMock(overrides: Partial<Deps['drive']> = {}): Deps['drive'] {
  return {
    readSourceFiles: vi.fn(() => makeSourceMaterials()),
    readRuleFiles: vi.fn(() => [makeRuleFile('10-cover-letter-industry.md')]),
    writeOutput: vi.fn(() => ({ docUrl: 'https://docs.google.com/doc/123', docId: 'doc-123' })),
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
    createFileInFolder: vi.fn(() => ({
      fileId: 'md-file-id-123',
      fileUrl: 'https://drive.google.com/file/d/md-file-id-123/view',
    })),
    createGoogleDoc: vi.fn(() => ({
      docId: 'doc-id-456',
      docUrl: 'https://docs.google.com/document/d/doc-id-456/edit',
    })),
    ...overrides,
  } as Deps['drive'];
}

function makePromptMock(): Deps['prompt'] {
  return {
    composeSystemPrompt: vi.fn(() => ({
      type: 'text' as const,
      text: 'You are a helpful assistant.',
      cache_control: { type: 'ephemeral' as const },
    })),
  };
}

function makeDeps(
  driveOverrides: Partial<Deps['drive']> = {},
  claudeResponse: ClaudeResponse = makeClaudeResponse(),
): Deps {
  return {
    drive: makeDriveMock(driveOverrides),
    claude: { call: vi.fn(() => claudeResponse) },
    prompt: makePromptMock(),
  };
}

// ---------------------------------------------------------------------------
// validateCoverLetter tests
// ---------------------------------------------------------------------------

describe('validateCoverLetter', () => {
  it('T4: missing resumeMd → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      jd: 'some jd',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
    });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('resumeMd');
  });

  it('T5: missing jd → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
    });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('jd');
  });

  it('T6: missing jobFolderId → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
    });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('jobFolderId');
  });

  it('missing sourceFolderId → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
  });

  it('missing model → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
  });

  it('all required fields present → returns null (valid)', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      company: null,
      role: null,
    });
    expect(result).toBeNull();
  });

  it('valid tone "formal" → returns null', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      tone: 'formal',
    });
    expect(result).toBeNull();
  });

  it('invalid tone string → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      tone: 'shouty',
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('tone');
  });

  it('non-string tone (number) → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      tone: 42,
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
  });

  it('H21: non-string company → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      company: 123,
      role: null,
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('company');
  });

  it('H21: non-string role → validation error', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
      company: null,
      role: { weird: true },
    });
    expect(result).not.toBeNull();
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('role');
  });

  it('H21: company/role omitted entirely → still valid', () => {
    const result = validateCoverLetter({
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'Some JD',
      jobFolderId: JOB_FOLDER_ID,
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      model: MODEL,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleCoverLetter tests
// ---------------------------------------------------------------------------

describe('handleCoverLetter', () => {
  it('T1: happy path returns coverLetterMd as non-empty string', () => {
    const deps = makeDeps();
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.coverLetterMd).toBe('string');
    expect(result.coverLetterMd.length).toBeGreaterThan(0);
  });

  it('T2: CL has >= 3 paragraphs (mocked 3-paragraph response)', () => {
    const deps = makeDeps();
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraphs = result.coverLetterMd.split('\n\n').filter(p => p.trim().length > 0);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
  });

  it('T3: docUrl and mdFileUrl are non-empty strings', () => {
    const deps = makeDeps();
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.docUrl).toBe('string');
    expect(result.docUrl.length).toBeGreaterThan(0);
    expect(typeof result.mdFileUrl).toBe('string');
    expect(result.mdFileUrl.length).toBeGreaterThan(0);
  });

  it('T7: Claude failure → ok:false, retryable:true', () => {
    const deps: Deps = {
      drive: makeDriveMock(),
      claude: {
        call: vi.fn(() => {
          throw new ClaudeApiError('server', 500, 'Internal server error');
        }),
      },
      prompt: makePromptMock(),
    };
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.type).toBe('server');
  });

  it('T8: drive write failure (createFileInFolder throws) → ok:false, type:"drive"', () => {
    const deps = makeDeps({
      createFileInFolder: vi.fn(() => {
        throw new Error('Folder not found: invalid-folder-id');
      }),
    });
    const req = makeRequest({ jobFolderId: 'invalid-folder-id' });
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('drive');
    expect(result.error.retryable).toBe(false);
  });

  it('T9: cost.totalUsd is a positive number', () => {
    const deps = makeDeps(
      {},
      makeClaudeResponse(MOCK_CL_TEXT),
    );
    // Ensure usage has non-zero tokens
    (deps.claude.call as ReturnType<typeof vi.fn>).mockReturnValue({
      text: MOCK_CL_TEXT,
      stopReason: 'end_turn',
      usage: makeClaudeUsage({ input_tokens: 1000, output_tokens: 500 }),
      model: MODEL,
    });

    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.cost.totalUsd).toBe('number');
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });

  it('T10: cover letter includes company name when provided', () => {
    const deps = makeDeps(
      {},
      makeClaudeResponse(MOCK_CL_TEXT), // MOCK_CL_TEXT contains "Acme Corp"
    );
    const req = makeRequest({ company: 'Acme Corp' });
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverLetterMd).toContain('Acme Corp');
  });

  it('drive readSourceFiles failure → ok:false, type:"drive"', () => {
    const deps = makeDeps({
      readSourceFiles: vi.fn(() => {
        throw new Error('Folder not found: bad-source-id');
      }),
    });
    const req = makeRequest({ sourceFolderId: 'bad-source-id' });
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('drive');
  });

  it('drive readRuleFiles failure → ok:false, type:"drive"', () => {
    const deps = makeDeps({
      readRuleFiles: vi.fn(() => {
        throw new Error('EmptyFolder');
      }),
    });
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('drive');
  });

  it('company and role appear in the Claude user message', () => {
    const deps = makeDeps();
    const req = makeRequest({ company: 'Acme Corp', role: 'Backend Lead' });
    handleCoverLetter(deps, req);

    const claudeCall = (deps.claude.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userContent = claudeCall.messages[0].content as string;
    expect(userContent).toContain('Acme Corp');
    expect(userContent).toContain('Backend Lead');
  });

  it('null company and role are handled gracefully', () => {
    const deps = makeDeps();
    const req = makeRequest({ company: null, role: null });
    const result = handleCoverLetter(deps, req);
    expect(result.ok).toBe(true);
  });

  it('createGoogleDoc failure → docUrl is empty string, overall ok:true', () => {
    const deps = makeDeps({
      createGoogleDoc: vi.fn(() => {
        throw new Error('Doc creation failed');
      }),
    });
    const req = makeRequest();
    const result = handleCoverLetter(deps, req);

    // Per contract: doc creation failure logs warning but continues
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docUrl).toBe('');
    // mdFileUrl should still be set
    expect(result.mdFileUrl.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tone selector tests (15-cl-tones.md)
  // ─────────────────────────────────────────────────────────────────────────

  it('tone="formal" appends a TONE directive citing "formal" to the system prompt', () => {
    const deps = makeDeps();
    const req = makeRequest({ tone: 'formal' });
    handleCoverLetter(deps, req);

    const claudeCall = (deps.claude.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemText = claudeCall.system[0].text as string;
    expect(systemText).toContain('=== TONE: formal ===');
    expect(systemText).toContain('formal');
    expect(systemText).toContain('=== END TONE ===');
    // Profile-specific marker: formal forbids contractions
    expect(systemText).toContain('full forms');
  });

  it('tone="casual" produces a DIFFERENT directive than tone="formal"', () => {
    const formalDeps = makeDeps();
    handleCoverLetter(formalDeps, makeRequest({ tone: 'formal' }));
    const formalSystem = (formalDeps.claude.call as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].system[0].text as string;

    const casualDeps = makeDeps();
    handleCoverLetter(casualDeps, makeRequest({ tone: 'casual' }));
    const casualSystem = (casualDeps.claude.call as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].system[0].text as string;

    expect(casualSystem).toContain('=== TONE: casual ===');
    expect(casualSystem).toContain('contractions');
    expect(casualSystem).not.toBe(formalSystem);
    // The casual block should NOT contain the formal-specific marker
    expect(casualSystem).not.toContain('=== TONE: formal ===');
  });

  it('tone="technical" injects metrics-forward directive', () => {
    const deps = makeDeps();
    handleCoverLetter(deps, makeRequest({ tone: 'technical' }));
    const systemText = (deps.claude.call as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].system[0].text as string;
    expect(systemText).toContain('=== TONE: technical ===');
    expect(systemText).toContain('metrics');
  });

  it('tone undefined → NO tone directive in system prompt (backwards-compatible)', () => {
    const deps = makeDeps();
    const req = makeRequest(); // no tone
    handleCoverLetter(deps, req);

    const systemText = (deps.claude.call as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].system[0].text as string;
    expect(systemText).not.toContain('=== TONE:');
    expect(systemText).not.toContain('=== END TONE ===');
  });

  it('tone="neutral" → NO tone directive (neutral is the documented default behavior)', () => {
    const deps = makeDeps();
    handleCoverLetter(deps, makeRequest({ tone: 'neutral' }));

    const systemText = (deps.claude.call as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].system[0].text as string;
    expect(systemText).not.toContain('=== TONE:');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sheet column back-fill (B1 / B6 — updateSheetRow integration)
  // ─────────────────────────────────────────────────────────────────────────

  it('sheetId + rowUrl provided → updateSheetRow called once with coverLetterUrl=docUrl', () => {
    const deps = makeDeps();
    const result = handleCoverLetter(
      deps,
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(deps.drive.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledWith(
      'sheet-abc',
      'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      { coverLetterUrl: result.docUrl },
    );
  });

  it('sheetId/rowUrl omitted → updateSheetRow NOT called', () => {
    const deps = makeDeps();
    handleCoverLetter(deps, makeRequest()); // no sheetId/rowUrl
    expect(deps.drive.updateSheetRow).not.toHaveBeenCalled();
  });

  it('updateSheetRow throwing does NOT fail handler — returns ok:true (graceful degradation)', () => {
    const deps = makeDeps({
      updateSheetRow: vi.fn(() => { throw new Error('sheet quota'); }),
    });
    const result = handleCoverLetter(
      deps,
      makeRequest({
        sheetId: 'sheet-abc',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5',
      }),
    );
    expect(result.ok).toBe(true);
    expect(deps.drive.updateSheetRow).toHaveBeenCalledOnce();
  });
});
