/**
 * @file tests/contracts/_setup.ts
 *
 * Shared utilities for BLACK-BOX contract tests against the Apps Script
 * `doPost()` HTTP entry point. These tests treat the system as opaque: build
 * a raw POST body, invoke `doPost(e, deps)`, parse the JSON response, then
 * assert against the typed shapes in `appsscript/src/types/api-contract.ts`.
 *
 * Nothing in this file (or in the tests) imports concrete handler internals;
 * the only "source" import is `doPost` itself (the seam between client and
 * server) and the shared types we assert against.
 */
import { vi } from 'vitest';
import type {
  ConcatenatedSourceMaterials,
  DriveOps,
  FileEntry,
} from '../../appsscript/src/types/drive-ops.js';
import type {
  ClaudeClient,
  ClaudeResponse,
} from '../../appsscript/src/types/claude-api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Common fixture IDs (string-shaped, unique per role — easier to scan in
// failed-assertion output than reusing the same id across roles)
// ─────────────────────────────────────────────────────────────────────────────

export const RULES_FOLDER_ID = 'rules-folder-id';
export const SOURCE_FOLDER_ID = 'source-folder-id';
export const OUTPUT_FOLDER_ID = 'output-folder-id';
export const SHEET_ID = 'sheet-id';
export const JOB_FOLDER_ID = 'job-folder-id';
export const MODEL = 'claude-haiku-4-5-20251001';

// ─────────────────────────────────────────────────────────────────────────────
// Event / response helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal GAS DoPost event from a payload object. */
export function makeEvent(payload: unknown): GoogleAppsScript.Events.DoPost {
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

/** Read a TextOutput via both `.content` and `.getContent()` and parse JSON. */
export function parseOutput(output: GoogleAppsScript.Content.TextOutput): unknown {
  // Code.ts test fallback exposes both .content and .getContent() so we can
  // verify the wrapper invariant: TextOutput.getContent() must parse to the
  // same payload as the raw .content getter.
  const accessor = output as unknown as {
    content?: string;
    getContent?: () => string;
  };
  const raw =
    typeof accessor.getContent === 'function'
      ? accessor.getContent()
      : (accessor.content as string);
  return JSON.parse(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive / Claude / Prompt mock factories
// ─────────────────────────────────────────────────────────────────────────────

export function makeRuleFile(name: string, loadBearing = false): FileEntry {
  return {
    name,
    fileId: `file-${name}`,
    contents: `# ${name}\nrule content`,
    tokens: 10,
    lastModifiedAt: 1_700_000_000_000,
    loadBearing,
  };
}

export function makeSourceMaterials(): ConcatenatedSourceMaterials {
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

/**
 * Default Claude response. Returns markdown (resumes) by default; tests that
 * need JSON-shaped output (research/benchmark/critique/etc.) override this
 * with their own `makeClaudeMock({ call: vi.fn(() => ...) })`.
 */
export function makeClaudeResponse(
  text = '# Tailored Resume\n\nPython is mentioned here.',
): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
    },
    model: MODEL,
  };
}

export function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  return {
    readSourceFiles: vi.fn(() => makeSourceMaterials()),
    readRuleFiles: vi.fn(() => [
      makeRuleFile('01-priority.md', false),
      makeRuleFile('10-cover-letter-industry.md', true),
    ]),
    writeOutput: vi.fn(() => ({
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
      docId: 'doc-id',
    })),
    writeJobOutput: vi.fn(() => ({
      jobFolderId: JOB_FOLDER_ID,
      jobFolderUrl: `https://drive.google.com/drive/folders/${JOB_FOLDER_ID}`,
      docId: 'doc-id',
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
      mdFileId: 'md-file-id',
      mdFileUrl: 'https://drive.google.com/file/d/md-file-id/view',
    })),
    readFile: vi.fn(() => makeRuleFile('any.md')),
    writeFile: vi.fn(() => ({ updatedAt: 1_700_000_000_000 })),
    seedDefaults: vi.fn(() => ({ seeded: ['01-priority.md'], errors: [] })),
    appendSheetRow: vi.fn(() => ({
      rowIndex: 2,
      rowUrl:
        'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0&range=A2',
    })),
    updateSheetRow: vi.fn(() => undefined),
    replaceDocContents: vi.fn(() => undefined),
    exportDocAs: vi.fn((_docId, _folderId, format, fileName) => ({
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
    uploadDocxFromBase64: vi.fn((_folderId, fileName, _b64) => ({
      fileId: 'uploaded-docx-id',
      url: 'https://drive.google.com/file/d/uploaded-docx-id/view',
      fileName,
    })),
    createFileInFolder: vi.fn((_folderId, _fileName, _content) => ({
      fileId: 'md-file-id',
      fileUrl: 'https://drive.google.com/file/d/md-file-id/view',
    })),
    createDriveFile: vi.fn((_fileName, _content, _mime, _parent) => ({
      fileId: 'new-drive-file-id',
      fileUrl: 'https://drive.google.com/file/d/new-drive-file-id/view',
    })),
    createGoogleDoc: vi.fn((_folderId, _title, _content) => ({
      docId: 'doc-id',
      docUrl: 'https://docs.google.com/document/d/doc-id/edit',
    })),
    ...overrides,
  };
}

export function makeClaudeMock(overrides: Partial<ClaudeClient> = {}): ClaudeClient {
  return {
    call: vi.fn(() => makeClaudeResponse()),
    ...overrides,
  };
}

export function makePromptMock(): {
  composeSystemPrompt: ReturnType<typeof vi.fn>;
} {
  return {
    composeSystemPrompt: vi.fn(() => ({
      type: 'text',
      text: 'You are a resume assistant.',
      cache_control: { type: 'ephemeral' },
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CacheService stub (research / benchmark handlers reach for the ambient
// global). We default to "no cache" — get() returns null, put() is recorded —
// so tests don't accidentally hit a cache from a previous test run.
// ─────────────────────────────────────────────────────────────────────────────

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

export function installCacheServiceStub(): CacheStub {
  const cache: CacheStub = {
    get: vi.fn(() => null),
    put: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).CacheService = {
    getScriptCache: () => cache,
  };
  return cache;
}

export function clearCacheServiceStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).CacheService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape guards — small narrow helpers so tests stay focused on the contract
// shape, not on the bookkeeping of `as` casts.
// ─────────────────────────────────────────────────────────────────────────────

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isApiError(
  v: unknown,
): v is { ok: false; error: { type: string; message: string; retryable: boolean } } {
  if (!isObject(v)) return false;
  if (v.ok !== false) return false;
  if (!isObject(v.error)) return false;
  const err = v.error;
  return (
    typeof err.type === 'string' &&
    typeof err.message === 'string' &&
    typeof err.retryable === 'boolean'
  );
}

/** The canonical, exhaustive error.type union from api-contract.ts. */
export const ERROR_TYPES = [
  'auth',
  'rate_limit',
  'server',
  'validation',
  'drive',
  'config',
  'other',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

/** retryable === true is only valid for rate_limit and server. */
export const RETRYABLE_ERROR_TYPES: readonly ErrorType[] = [
  'rate_limit',
  'server',
] as const;

/** Asserts JSON-serializability: no functions / no circular refs. */
export function assertJsonSerializable(value: unknown): void {
  const s = JSON.stringify(value);
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('value did not produce a JSON string');
  }
  // Round-trip must not throw.
  JSON.parse(s);
}
