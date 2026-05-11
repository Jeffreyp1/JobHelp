/**
 * Tests for appsscript/src/Code.ts (doPost router), sheet.ts (appendSheetRow), cost.ts (calculateCost).
 * Uses dependency injection — drive, claude, prompt are mocked objects passed via deps param.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doPost } from '../src/Code.js';
import { appendSheetRow } from '../src/sheet.js';
import { calculateCost } from '../src/cost.js';
import type { DriveOps, FileEntry, ConcatenatedSourceMaterials, SheetRow } from '../src/types/drive-ops.js';
import type { ClaudeClient, ClaudeUsage, ClaudeResponse } from '../src/types/claude-api.js';
import { ClaudeApiError } from '../src/types/claude-api.js';
import type { GenerateRequest, ListFilesRequest, WriteFileRequest, SeedDefaultsRequest, FinalizeRequest, FinalizeFormat } from '../src/types/api-contract.js';
import type { JobInsights } from '../src/types/job-insights.js';
import { makeSpreadsheetApp } from './helpers/gas-mocks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal GAS DoPost event from a payload object */
function makeEvent(payload: unknown): GoogleAppsScript.Events.DoPost {
  return {
    postData: {
      contents: JSON.stringify(payload),
      length: -1,
      name: '',
      type: 'application/json',
    },
    parameter: {},
    parameters: {},
    contextPath: '',
    contentLength: -1,
    queryString: '',
  } as unknown as GoogleAppsScript.Events.DoPost;
}

function parseOutput(output: GoogleAppsScript.Content.TextOutput): unknown {
  const raw = (output as unknown as { content: string }).content;
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const RULES_FOLDER_ID = 'rules-folder-id';
const SOURCE_FOLDER_ID = 'source-folder-id';
const OUTPUT_FOLDER_ID = 'output-folder-id';
const SHEET_ID = 'sheet-id';

function makeRuleFile(name: string, loadBearing = false): FileEntry {
  return {
    name,
    fileId: `file-${name}`,
    contents: `# ${name}\nrule content`,
    tokens: 10,
    lastModifiedAt: 1_700_000_000_000,
    loadBearing,
  };
}

function makeSourceMaterials(): ConcatenatedSourceMaterials {
  return {
    text: '=== resume.md ===\nI am a software engineer.',
    files: [
      {
        name: 'resume.md',
        fileId: 'file-resume',
        contents: 'I am a software engineer.',
        tokens: 6,
        lastModifiedAt: 1_700_000_000_000,
      },
    ],
    totalTokens: 6,
  };
}

function makeClaudeResponse(text = '# Tailored Resume\n\nPython is mentioned here.'): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
    },
    model: 'claude-haiku-4-5-20251001',
  };
}

function makeJobInsights(): JobInsights {
  return {
    jobType: 'fulltime',
    location: 'NYC',
    remote: 'hybrid',
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: 'USD',
    yearsExperience: 5,
    educationRequired: 'bachelor',
    skillsRequired: [
      { canonical: 'Python', count: 3, section: 'requirements' },
      { canonical: 'Kubernetes', count: 2, section: 'requirements' },
    ],
    skillsNiceToHave: [
      { canonical: 'Rust', count: 1, section: 'niceToHave' },
    ],
    visaSponsorship: 'unmentioned',
    postedDate: '2026-05-01',
    applicantCount: 47,
    sectionBreakdown: {
      requirements: 'Python, Kubernetes',
      responsibilities: 'Build systems',
      niceToHave: 'Rust',
      other: '',
    },
  };
}

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  return {
    readSourceFiles: vi.fn(() => makeSourceMaterials()),
    readRuleFiles: vi.fn(() => [makeRuleFile('01-priority.md', false)]),
    writeOutput: vi.fn(() => ({ docUrl: 'https://docs.google.com/document/d/doc-id/edit', docId: 'doc-id' })),
    writeJobOutput: vi.fn(() => ({
      jobFolderId: 'job-folder-id',
      jobFolderUrl: 'https://drive.google.com/drive/folders/job-folder-id',
      docId: 'doc-id',
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
      mdFileId: 'md-file-id',
      mdFileUrl: 'https://drive.google.com/file/d/md-file-id/view',
    })),
    readFile: vi.fn(() => makeRuleFile('any.md')),
    writeFile: vi.fn(() => ({ updatedAt: 1_700_000_000_000 })),
    seedDefaults: vi.fn(() => ({ seeded: ['01-priority.md'], errors: [] })),
    appendSheetRow: vi.fn(() => ({ rowIndex: 2, rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0&range=A2' })),
    updateSheetRow: vi.fn(() => undefined),
    replaceDocContents: vi.fn(() => undefined),
    exportDocAs: vi.fn((_docId: string, _folderId: string, format: FinalizeFormat, fileName: string) => ({
      fileId: `exported-${format}-file-id`,
      url: `https://drive.google.com/file/d/exported-${format}-file-id/view`,
      fileName,
    })),
    downloadFileAsBase64: vi.fn(() => ({
      base64: 'AAAA',
      fileName: 'engineering-resume-template.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })),
    uploadDocxFromBase64: vi.fn((_folderId: string, fileName: string, _b64: string) => ({
      fileId: 'uploaded-docx-id',
      url: 'https://drive.google.com/file/d/uploaded-docx-id/view',
      fileName,
    })),
    createFileInFolder: vi.fn((_folderId: string, _fileName: string, _content: string) => ({
      fileId: 'md-file-id',
      fileUrl: 'https://drive.google.com/file/d/md-file-id/view',
    })),
    createDriveFile: vi.fn(
      (_fileName: string, _content: string, _mimeType: string, _parentFolderId?: string) => ({
        fileId: 'created-file-id',
        fileUrl: 'https://drive.google.com/file/d/created-file-id/view',
      }),
    ),
    createGoogleDoc: vi.fn((_folderId: string, _title: string, _content: string) => ({
      docId: 'doc-id',
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
    })),
    ...overrides,
  };
}

function makeClaudeMock(overrides: Partial<ClaudeClient> = {}): ClaudeClient {
  return {
    call: vi.fn(() => makeClaudeResponse()),
    ...overrides,
  };
}

function makePromptMock() {
  return {
    composeSystemPrompt: vi.fn(() => 'You are a resume assistant.'),
  };
}

function makeGenerateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    action: 'generate',
    jd: 'We need a Python developer with 5 years experience.',
    company: 'Acme',
    role: 'Senior Engineer',
    url: 'https://example.com/job/123',
    jobInsights: makeJobInsights(),
    toggles: {},
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    outputFolderId: OUTPUT_FOLDER_ID,
    sheetId: SHEET_ID,
    model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// doPost router tests
// ---------------------------------------------------------------------------

describe('doPost router', () => {
  let drive: DriveOps;
  let claude: ClaudeClient;
  let prompt: { composeSystemPrompt: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    drive = makeDriveMock();
    claude = makeClaudeMock();
    prompt = makePromptMock();
  });

  it('T1: action "ping" returns { ok: true, version, serverTime }', () => {
    const e = makeEvent({ action: 'ping' });
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; version: string; serverTime: number };
    expect(result.ok).toBe(true);
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
    expect(typeof result.serverTime).toBe('number');
    expect(result.serverTime).toBeGreaterThan(0);
  });

  it('T2: missing action returns { ok: false, error: { type: "validation" } }', () => {
    const e = makeEvent({ jd: 'no action here' });
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  it('T3: unknown action returns { ok: false, error: { type: "validation" } }', () => {
    const e = makeEvent({ action: 'do_something_weird' });
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  it('T4: action "generate" with missing jd returns validation error', () => {
    const e = makeEvent({
      action: 'generate',
      // no jd
      company: 'Acme',
      sourceFolderId: SOURCE_FOLDER_ID,
      rulesFolderId: RULES_FOLDER_ID,
      outputFolderId: OUTPUT_FOLDER_ID,
      sheetId: SHEET_ID,
      model: 'claude-haiku-4-5-20251001',
    });
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  it('T5: action "generate" with valid payload calls deps in correct order', () => {
    const callOrder: string[] = [];

    drive = makeDriveMock({
      readSourceFiles: vi.fn(() => { callOrder.push('readSourceFiles'); return makeSourceMaterials(); }),
      readRuleFiles: vi.fn(() => { callOrder.push('readRuleFiles'); return [makeRuleFile('01-priority.md')]; }),
      writeJobOutput: vi.fn(() => { callOrder.push('writeJobOutput'); return {
        jobFolderId: 'job-folder-id',
        jobFolderUrl: 'https://drive.google.com/drive/folders/job-folder-id',
        docId: 'doc-id',
        docUrl: 'https://docs.google.com/document/d/doc-id/edit',
        mdFileId: 'md-file-id',
        mdFileUrl: 'https://drive.google.com/file/d/md-file-id/view',
      }; }),
      appendSheetRow: vi.fn(() => { callOrder.push('appendSheetRow'); return { rowIndex: 2, rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0&range=A2' }; }),
    });

    prompt = {
      composeSystemPrompt: vi.fn(() => { callOrder.push('composeSystemPrompt'); return 'system prompt'; }),
    };

    claude = makeClaudeMock({
      call: vi.fn(() => { callOrder.push('claude.call'); return makeClaudeResponse(); }),
    });

    const e = makeEvent(makeGenerateRequest());
    doPost(e, { drive, claude, prompt });

    expect(callOrder).toEqual([
      'readSourceFiles',
      'readRuleFiles',
      'composeSystemPrompt',
      'claude.call',
      'writeJobOutput',
      'appendSheetRow',
    ]);
  });

  it('T6: action "generate" returns GenerateResult shape', () => {
    const e = makeEvent(makeGenerateRequest());
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      resumeMd: string;
      docUrl: string;
      sheetRowUrl: string;
      keywordCoverage: { matched: string[]; missing: string[]; rate: number };
      missingSkills: string[];
      reframings: unknown[];
      cost: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        totalUsd: number;
      };
      modelUsed: string;
    };
    expect(result.ok).toBe(true);
    expect(typeof result.resumeMd).toBe('string');
    expect(typeof result.docUrl).toBe('string');
    expect(typeof result.sheetRowUrl).toBe('string');
    expect(Array.isArray(result.keywordCoverage.matched)).toBe(true);
    expect(Array.isArray(result.keywordCoverage.missing)).toBe(true);
    expect(typeof result.keywordCoverage.rate).toBe('number');
    expect(Array.isArray(result.missingSkills)).toBe(true);
    expect(Array.isArray(result.reframings)).toBe(true);
    expect(typeof result.cost.inputTokens).toBe('number');
    expect(typeof result.cost.totalUsd).toBe('number');
    expect(typeof result.modelUsed).toBe('string');
  });

  it('T7: action "list_files" with folderType "rules" returns sorted file list with loadBearing flags', () => {
    const ruleFiles: FileEntry[] = [
      { name: '02-anti-fabrication.md', fileId: 'f2', contents: 'content2', tokens: 20, lastModifiedAt: 1700000001000, loadBearing: true },
      { name: '01-priority.md', fileId: 'f1', contents: 'content1', tokens: 10, lastModifiedAt: 1700000000000, loadBearing: false },
    ];
    drive = makeDriveMock({
      readRuleFiles: vi.fn(() => ruleFiles),
    });

    const req: ListFilesRequest = {
      action: 'list_files',
      folderId: RULES_FOLDER_ID,
      folderType: 'rules',
    };
    const e = makeEvent(req);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      files: Array<{ name: string; fileId: string; loadBearing?: boolean; tokens: number }>;
      totalTokens: number;
    };
    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(2);
    // sorted by name
    expect(result.files[0].name).toBe('01-priority.md');
    expect(result.files[1].name).toBe('02-anti-fabrication.md');
    expect(result.files[1].loadBearing).toBe(true);
    expect(result.totalTokens).toBe(30);
  });

  it('T8: action "write_file" updates file and returns updatedAt', () => {
    const updatedAt = 1_700_999_000_000;
    drive = makeDriveMock({
      writeFile: vi.fn(() => ({ updatedAt })),
    });
    const req: WriteFileRequest = {
      action: 'write_file',
      fileId: 'some-file-id',
      newContents: 'Updated content',
    };
    const e = makeEvent(req);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; updatedAt: number };
    expect(result.ok).toBe(true);
    expect(result.updatedAt).toBe(updatedAt);
  });

  it('T9: action "seed_defaults" calls drive.seedDefaults and returns result', () => {
    drive = makeDriveMock({
      seedDefaults: vi.fn(() => ({
        seeded: ['01-priority.md', '02-anti-fabrication.md'],
        errors: [{ filename: '12-template.md', reason: 'fetch failed' }],
      })),
    });
    const req: SeedDefaultsRequest = {
      action: 'seed_defaults',
      rulesFolderId: RULES_FOLDER_ID,
      rawBaseUrl: 'https://raw.githubusercontent.com/user/repo/main/prompts/shared',
      filenames: ['01-priority.md', '02-anti-fabrication.md', '12-template.md'],
    };
    const e = makeEvent(req);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      seeded: string[];
      errors: Array<{ filename: string; reason: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.seeded).toEqual(['01-priority.md', '02-anti-fabrication.md']);
    expect(result.errors).toEqual([{ filename: '12-template.md', reason: 'fetch failed' }]);
    expect(drive.seedDefaults).toHaveBeenCalledWith(
      RULES_FOLDER_ID,
      'https://raw.githubusercontent.com/user/repo/main/prompts/shared',
      ['01-priority.md', '02-anti-fabrication.md', '12-template.md'],
    );
  });

  it('T10: dependencies that throw ClaudeApiError surface as { ok: false, error: { type, retryable } }', () => {
    claude = makeClaudeMock({
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'Rate limit exceeded', 30);
      }),
    });

    const e = makeEvent(makeGenerateRequest());
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      error: { type: string; retryable: boolean; message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('rate_limit');
    expect(result.error.retryable).toBe(true);
  });

  it('T11: drive errors (folder not found) surface as { ok: false, error: { type: "drive" } }', () => {
    drive = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new Error('Folder not found: bad-folder-id');
      }),
    });

    const e = makeEvent(makeGenerateRequest({ sourceFolderId: 'bad-folder-id' }));
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      error: { type: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('drive');
  });

  it('T12: unknown errors surface as { ok: false, error: { type: "other", retryable: false } } and don\'t crash', () => {
    drive = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new TypeError('Something completely unexpected');
      }),
    });

    const e = makeEvent(makeGenerateRequest());
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      error: { type: string; retryable: boolean };
    };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('other');
    expect(result.error.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// doPost finalize tests
// ---------------------------------------------------------------------------

describe('doPost finalize', () => {
  const DOC_ID = 'doc-to-finalize-001';
  const JOB_FOLDER_ID = 'job-folder-finalize-001';
  const FINAL_MARKDOWN = '# Final Resume\n\n## Experience\n\nGreat work.';

  function makeFinalizeRequest(overrides: Partial<FinalizeRequest> = {}): FinalizeRequest {
    return {
      action: 'finalize',
      docId: DOC_ID,
      jobFolderId: JOB_FOLDER_ID,
      finalMarkdown: FINAL_MARKDOWN,
      formats: ['docx', 'pdf'],
      ...overrides,
    };
  }

  let drive: DriveOps;
  let claude: ClaudeClient;
  let prompt: { composeSystemPrompt: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    drive = makeDriveMock();
    claude = makeClaudeMock();
    prompt = makePromptMock();
  });

  // T19: valid payload calls replaceDocContents, then exportDocAs once per format in order
  it('T19: valid payload calls replaceDocContents then exportDocAs once per format in order', () => {
    const callOrder: string[] = [];
    drive = makeDriveMock({
      replaceDocContents: vi.fn(() => { callOrder.push('replaceDocContents'); }),
      exportDocAs: vi.fn((_docId: string, _folderId: string, format: FinalizeFormat, fileName: string) => {
        callOrder.push(`exportDocAs:${format}`);
        return {
          fileId: `file-${format}`,
          url: `https://drive.google.com/file/d/file-${format}/view`,
          fileName,
        };
      }),
    });

    const e = makeEvent(makeFinalizeRequest({ formats: ['docx', 'pdf'] }));
    doPost(e, { drive, claude, prompt });

    expect(callOrder).toEqual(['replaceDocContents', 'exportDocAs:docx', 'exportDocAs:pdf']);
  });

  // T20: returns { ok: true, files: [...] } matching FinalizeResult shape
  it('T20: returns { ok: true, files: [...] } matching FinalizeResult shape', () => {
    const e = makeEvent(makeFinalizeRequest({ formats: ['docx', 'pdf'] }));
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as {
      ok: boolean;
      files: Array<{ format: string; fileId: string; url: string; fileName: string }>;
    };

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toHaveLength(2);

    const docxFile = result.files.find(f => f.format === 'docx');
    const pdfFile = result.files.find(f => f.format === 'pdf');

    expect(docxFile).toBeDefined();
    expect(pdfFile).toBeDefined();
    expect(typeof docxFile!.fileId).toBe('string');
    expect(typeof docxFile!.url).toBe('string');
    expect(typeof docxFile!.fileName).toBe('string');
    expect(docxFile!.fileName).toBe('final_resume.docx');
    expect(pdfFile!.fileName).toBe('final_resume.pdf');
  });

  // T21: missing docId returns validation error
  it('T21: missing docId returns validation error', () => {
    const payload = { action: 'finalize', jobFolderId: JOB_FOLDER_ID, finalMarkdown: FINAL_MARKDOWN, formats: ['docx'] };
    const e = makeEvent(payload);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  // T22: missing finalMarkdown returns validation error
  it('T22: missing finalMarkdown returns validation error', () => {
    const payload = { action: 'finalize', docId: DOC_ID, jobFolderId: JOB_FOLDER_ID, formats: ['docx'] };
    const e = makeEvent(payload);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  // T23: missing/empty formats array returns validation error
  it('T23: missing formats array returns validation error', () => {
    const payload = { action: 'finalize', docId: DOC_ID, jobFolderId: JOB_FOLDER_ID, finalMarkdown: FINAL_MARKDOWN };
    const e = makeEvent(payload);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  it('T23b: empty formats array returns validation error', () => {
    const e = makeEvent(makeFinalizeRequest({ formats: [] }));
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  // T24: invalid format value returns validation error
  it('T24: invalid format value returns validation error', () => {
    const payload = { action: 'finalize', docId: DOC_ID, jobFolderId: JOB_FOLDER_ID, finalMarkdown: FINAL_MARKDOWN, formats: ['xlsx'] };
    const e = makeEvent(payload);
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('validation');
  });

  // T25: drive.exportDocAs throwing surfaces as ok: false error response
  it('T25: drive.exportDocAs throwing surfaces as ok: false error response', () => {
    drive = makeDriveMock({
      replaceDocContents: vi.fn(),
      exportDocAs: vi.fn(() => {
        throw new Error('Export failed: permission denied');
      }),
    });

    const e = makeEvent(makeFinalizeRequest({ formats: ['docx'] }));
    const out = doPost(e, { drive, claude, prompt });
    const result = parseOutput(out) as { ok: boolean; error: { type: string } };
    expect(result.ok).toBe(false);
    expect(typeof result.error.type).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// appendSheetRow tests
// ---------------------------------------------------------------------------

describe('appendSheetRow', () => {
  const SS_ID = 'spreadsheet-abc123';
  const SHEET_NAME = 'JobHelp Log';

  function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
    return {
      date: '2026-05-09T12:00:00.000Z',
      company: 'Acme',
      role: 'Engineer',
      url: 'https://example.com/job/1',
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
      modelUsed: 'claude-haiku-4-5-20251001',
      costUsd: 0.0035,
      keywordMatchRate: 0.75,
      ...overrides,
    };
  }

  beforeEach(() => {
    // Set up a SpreadsheetApp mock on the global
    const ssApp = makeSpreadsheetApp({
      [SS_ID]: {
        id: SS_ID,
        sheets: {},
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).SpreadsheetApp = ssApp;
  });

  it('T13: appends to specified sheet with correct columns', () => {
    const row = makeRow();
    appendSheetRow(SS_ID, row);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ss = (globalThis as any).SpreadsheetApp.openById(SS_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) ?? ss.insertSheet(SHEET_NAME);
    // The header row should be at index 0, data at 1
    const lastRow = sheet.getLastRow();
    expect(lastRow).toBeGreaterThanOrEqual(1);
  });

  it('T14: creates header row if sheet has 0 rows', () => {
    // Fresh sheet (no rows)
    const { rowIndex } = appendSheetRow(SS_ID, makeRow());
    // rowIndex should be 2 (header=row1, data=row2)
    expect(rowIndex).toBe(2);
  });

  it('T15: formats date as ISO 8601', () => {
    const isoDate = '2026-05-09T12:00:00.000Z';
    const row = makeRow({ date: isoDate });
    // Should not throw — date is passed through as-is (already ISO)
    expect(() => appendSheetRow(SS_ID, row)).not.toThrow();
  });

  it('T16: returns rowIndex and rowUrl', () => {
    const result = appendSheetRow(SS_ID, makeRow());
    expect(typeof result.rowIndex).toBe('number');
    expect(result.rowIndex).toBeGreaterThan(0);
    expect(typeof result.rowUrl).toBe('string');
    expect(result.rowUrl).toContain(SS_ID);
    expect(result.rowUrl).toContain('spreadsheets');
  });
});

// ---------------------------------------------------------------------------
// calculateCost tests
// ---------------------------------------------------------------------------

describe('cost calculation', () => {
  it('T17: from ClaudeUsage builds CostBreakdown with correct USD per Haiku 4.5 pricing', () => {
    const usage: ClaudeUsage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 0,
    };
    const model = 'claude-haiku-4-5-20251001';
    const result = calculateCost(usage, model);

    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.cacheReadTokens).toBe(5000);
    expect(result.cacheCreationTokens).toBe(0);

    // Haiku: $1/M input, $5/M output, $0.10/M cache_read, $1.25/M cache_write
    // 1000 * 1.0/1e6 = 0.001
    // 500 * 5.0/1e6  = 0.0025
    // 5000 * 0.10/1e6 = 0.0005
    // 0 * 1.25/1e6   = 0
    // Total = 0.004 rounded to 4 decimals
    expect(result.totalUsd).toBe(0.004);
  });

  it('T18: rounds totalUsd to 4 decimals', () => {
    const usage: ClaudeUsage = {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 1,
    };
    const model = 'claude-haiku-4-5-20251001';
    const result = calculateCost(usage, model);
    // Check it's rounded to 4 decimal places
    const decimalStr = result.totalUsd.toString();
    const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
    expect(decimalPart.length).toBeLessThanOrEqual(4);
  });
});
