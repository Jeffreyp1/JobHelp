/**
 * TDD tests for appsscript/src/drive.ts — Drive operations + first-run seeding.
 * All 18 tests must pass against the DriveOps implementation.
 *
 * GAS globals are injected via vi.stubGlobal so the module runs in Node/Vitest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  makeDriveApp,
  makeSpreadsheetApp,
  makeUrlFetchApp,
  makeCacheService,
  makeDocumentApp,
  folderMap,
  mockMdFile,
  mockTextFile,
  type MockDoc,
} from './helpers/gas-mocks.js';

// Import the implementation (after it is written)
import { driveOps } from '../src/drive.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_FOLDER_ID = 'source-folder-001';
const RULES_FOLDER_ID  = 'rules-folder-001';
const OUTPUT_FOLDER_ID = 'output-folder-001';
const SHEET_ID         = 'sheet-001';
const RAW_BASE_URL     = 'https://raw.githubusercontent.com/example/jobhelp/main/prompts/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupGlobals(opts: {
  driveApp?: ReturnType<typeof makeDriveApp>;
  spreadsheetApp?: ReturnType<typeof makeSpreadsheetApp>;
  urlFetchApp?: ReturnType<typeof makeUrlFetchApp>;
  cacheService?: ReturnType<typeof makeCacheService>;
  documentApp?: ReturnType<typeof makeDocumentApp>;
}) {
  if (opts.driveApp)       vi.stubGlobal('DriveApp',       opts.driveApp);
  if (opts.spreadsheetApp) vi.stubGlobal('SpreadsheetApp', opts.spreadsheetApp);
  if (opts.urlFetchApp)    vi.stubGlobal('UrlFetchApp',    opts.urlFetchApp);
  if (opts.cacheService)   vi.stubGlobal('CacheService',   opts.cacheService);
  if (opts.documentApp)    vi.stubGlobal('DocumentApp',    opts.documentApp);
}

// ---------------------------------------------------------------------------
// describe: DriveOps.readSourceFiles
// ---------------------------------------------------------------------------

describe('DriveOps.readSourceFiles', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // T1: returns concatenated content with === filename === headers in alphabetical order
  it('T1: returns concatenated content with === filename === headers in alphabetical order', () => {
    const files = [
      mockMdFile('zebra.md', 'Zebra content'),
      mockMdFile('alpha.md', 'Alpha content'),
      mockMdFile('middle.md', 'Middle content'),
    ];

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: SOURCE_FOLDER_ID, files }])),
      cacheService: makeCacheService(),
    });

    const result = driveOps.readSourceFiles(SOURCE_FOLDER_ID);

    // Must be alphabetical: alpha, middle, zebra
    expect(result.files.map(f => f.name)).toEqual(['alpha.md', 'middle.md', 'zebra.md']);

    // Check separator headers are present in order
    const text = result.text;
    const alphaIdx  = text.indexOf('=== alpha.md ===');
    const middleIdx = text.indexOf('=== middle.md ===');
    const zebraIdx  = text.indexOf('=== zebra.md ===');

    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(middleIdx).toBeGreaterThan(alphaIdx);
    expect(zebraIdx).toBeGreaterThan(middleIdx);

    expect(text).toContain('Alpha content');
    expect(text).toContain('Middle content');
    expect(text).toContain('Zebra content');
  });

  // T2: throws on invalid folder id
  it('T2: throws on invalid folder id', () => {
    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: SOURCE_FOLDER_ID, files: [] }])),
      cacheService: makeCacheService(),
    });

    expect(() => driveOps.readSourceFiles('invalid-folder-id')).toThrow();
  });

  // T3: returns empty text and files when folder exists but has no .md files
  it('T3: returns empty when folder exists but has no .md files', () => {
    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: SOURCE_FOLDER_ID, files: [] }])),
      cacheService: makeCacheService(),
    });

    const result = driveOps.readSourceFiles(SOURCE_FOLDER_ID);
    expect(result.files).toHaveLength(0);
    expect(result.text).toBe('');
    expect(result.totalTokens).toBe(0);
  });

  // T4: skips non-.md files
  it('T4: skips non-.md files', () => {
    const files = [
      mockMdFile('resume.md', 'MD content'),
      mockTextFile('notes.txt', 'Text content', 'text/plain'),
      mockTextFile('image.png', 'PNG data', 'image/png'),
    ];

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: SOURCE_FOLDER_ID, files }])),
      cacheService: makeCacheService(),
    });

    const result = driveOps.readSourceFiles(SOURCE_FOLDER_ID);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('resume.md');
  });

  // T5: caches results for 10 minutes via CacheService
  it('T5: caches results for 10 minutes via CacheService', () => {
    const files = [mockMdFile('resume.md', 'Content here')];
    const cacheService = makeCacheService();
    const driveApp = makeDriveApp(folderMap([{ id: SOURCE_FOLDER_ID, files }]));

    setupGlobals({ driveApp, cacheService });

    // First call — should hit Drive and populate cache
    const first = driveOps.readSourceFiles(SOURCE_FOLDER_ID);

    // Inject cached data so second call should use it
    const scriptCache = cacheService.getScriptCache();

    // Second call — should use cache, not call DriveApp again
    const second = driveOps.readSourceFiles(SOURCE_FOLDER_ID);

    expect(first.text).toBe(second.text);

    // put was called at least once with a TTL of 600 (10 minutes)
    const putCalls = scriptCache.put.mock.calls;
    const cacheCallWith600 = putCalls.some(
      (args: unknown[]) => typeof args[2] === 'number' && args[2] === 600,
    );
    expect(cacheCallWith600).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.readRuleFiles
// ---------------------------------------------------------------------------

describe('DriveOps.readRuleFiles', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // T6: returns 12 files in alphanumeric order when seeded
  it('T6: returns 12 files in alphanumeric order when seeded', () => {
    // Deliberately out-of-order to test sorting
    const ruleFiles = [
      mockMdFile('12-template-reproduction.md', '# 12'),
      mockMdFile('03-banned-words.md', '# 03'),
      mockMdFile('07-reframing-strategies.md', '# 07'),
      mockMdFile('01-priority-hierarchy.md', '# 01'),
      mockMdFile('11-self-scan-checklist.md', '# 11'),
      mockMdFile('06-bullet-construction.md', '# 06'),
      mockMdFile('10-cover-letter-industry.md', '# 10'),
      mockMdFile('05-structural-rules.md', '# 05'),
      mockMdFile('09-section-structure.md', '# 09'),
      mockMdFile('04-banned-phrases.md', '# 04'),
      mockMdFile('08-bridge-language.md', '# 08'),
      mockMdFile('02-anti-fabrication.md', '# 02'),
    ];

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: RULES_FOLDER_ID, files: ruleFiles }])),
      cacheService: makeCacheService(),
    });

    const result = driveOps.readRuleFiles(RULES_FOLDER_ID);
    expect(result).toHaveLength(12);

    const names = result.map(f => f.name);
    expect(names[0]).toBe('01-priority-hierarchy.md');
    expect(names[11]).toBe('12-template-reproduction.md');

    // Verify full alphanumeric order
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  // T7: throws "EmptyFolder" error when folder is empty
  it('T7: throws "EmptyFolder" error when folder is empty', () => {
    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: RULES_FOLDER_ID, files: [] }])),
      cacheService: makeCacheService(),
    });

    expect(() => driveOps.readRuleFiles(RULES_FOLDER_ID)).toThrowError('EmptyFolder');
  });

  // T8: extracts loadBearing from frontmatter ("load_bearing: true")
  it('T8: extracts loadBearing from frontmatter ("load_bearing: true")', () => {
    const withFrontmatter = mockMdFile(
      '02-anti-fabrication.md',
      '---\nload_bearing: true\n---\n\n# Anti-fabrication rules',
    );
    const withoutFrontmatter = mockMdFile(
      '03-banned-words.md',
      '# Banned words (no frontmatter)',
    );
    const withFalseFrontmatter = mockMdFile(
      '01-priority-hierarchy.md',
      '---\nload_bearing: false\n---\n\n# Priority hierarchy',
    );

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{
        id: RULES_FOLDER_ID,
        files: [withFrontmatter, withoutFrontmatter, withFalseFrontmatter],
      }])),
      cacheService: makeCacheService(),
    });

    const result = driveOps.readRuleFiles(RULES_FOLDER_ID);
    const byName = Object.fromEntries(result.map(f => [f.name, f]));

    expect(byName['02-anti-fabrication.md'].loadBearing).toBe(true);
    expect(byName['03-banned-words.md'].loadBearing).toBeFalsy();
    expect(byName['01-priority-hierarchy.md'].loadBearing).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.seedDefaults
// ---------------------------------------------------------------------------

describe('DriveOps.seedDefaults', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const FILENAMES = ['01-priority-hierarchy.md', '02-anti-fabrication.md'];

  // T9: fetches each filename from rawBaseUrl + "/" + filename and creates Drive files
  it('T9: fetches each filename from rawBaseUrl + "/" + filename and creates Drive files', () => {
    const fetchResponses = {
      [`${RAW_BASE_URL}/01-priority-hierarchy.md`]: { status: 200, body: '# Priority Hierarchy' },
      [`${RAW_BASE_URL}/02-anti-fabrication.md`]:   { status: 200, body: '# Anti-fabrication' },
    };

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: RULES_FOLDER_ID, files: [] }])),
      urlFetchApp: makeUrlFetchApp(fetchResponses),
      cacheService: makeCacheService(),
    });

    const result = driveOps.seedDefaults(RULES_FOLDER_ID, RAW_BASE_URL, FILENAMES);

    expect(result.seeded).toHaveLength(2);
    expect(result.seeded).toContain('01-priority-hierarchy.md');
    expect(result.seeded).toContain('02-anti-fabrication.md');
    expect(result.errors).toHaveLength(0);

    // Verify UrlFetchApp was called with correct URLs
    const urlFetch = (globalThis as unknown as { UrlFetchApp: ReturnType<typeof makeUrlFetchApp> }).UrlFetchApp;
    expect(urlFetch.fetch).toHaveBeenCalledWith(
      `${RAW_BASE_URL}/01-priority-hierarchy.md`,
      expect.anything(),
    );
    expect(urlFetch.fetch).toHaveBeenCalledWith(
      `${RAW_BASE_URL}/02-anti-fabrication.md`,
      expect.anything(),
    );
  });

  // T10: returns partial success on individual fetch failure (other files still seeded)
  it('T10: returns partial success on individual fetch failure (other files still seeded)', () => {
    const fetchResponses = {
      [`${RAW_BASE_URL}/01-priority-hierarchy.md`]: { status: 200, body: '# Priority Hierarchy' },
      [`${RAW_BASE_URL}/02-anti-fabrication.md`]:   { status: 500, body: 'Server Error' },
    };

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: RULES_FOLDER_ID, files: [] }])),
      urlFetchApp: makeUrlFetchApp(fetchResponses),
      cacheService: makeCacheService(),
    });

    const result = driveOps.seedDefaults(RULES_FOLDER_ID, RAW_BASE_URL, FILENAMES);

    expect(result.seeded).toHaveLength(1);
    expect(result.seeded).toContain('01-priority-hierarchy.md');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].filename).toBe('02-anti-fabrication.md');
    expect(result.errors[0].reason).toBeTruthy();
  });

  // T11: skips files that already exist (idempotent)
  it('T11: skips files that already exist (idempotent)', () => {
    const existingFile = mockMdFile('01-priority-hierarchy.md', 'Existing content');
    const fetchResponses = {
      [`${RAW_BASE_URL}/01-priority-hierarchy.md`]: { status: 200, body: '# New Priority Hierarchy' },
      [`${RAW_BASE_URL}/02-anti-fabrication.md`]:   { status: 200, body: '# Anti-fabrication' },
    };

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: RULES_FOLDER_ID, files: [existingFile] }])),
      urlFetchApp: makeUrlFetchApp(fetchResponses),
      cacheService: makeCacheService(),
    });

    const result = driveOps.seedDefaults(RULES_FOLDER_ID, RAW_BASE_URL, FILENAMES);

    // Only the new file should be seeded; existing one should be skipped
    expect(result.seeded).toContain('02-anti-fabrication.md');
    expect(result.seeded).not.toContain('01-priority-hierarchy.md');
    expect(result.errors).toHaveLength(0);

    // Verify the existing file's content was NOT overwritten
    const urlFetch = (globalThis as unknown as { UrlFetchApp: ReturnType<typeof makeUrlFetchApp> }).UrlFetchApp;
    // Should not fetch for the already-existing file
    const fetchedUrls = urlFetch.fetch.mock.calls.map((c: unknown[]) => c[0]);
    expect(fetchedUrls).not.toContain(`${RAW_BASE_URL}/01-priority-hierarchy.md`);
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.writeOutput
// ---------------------------------------------------------------------------

describe('DriveOps.writeOutput', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // T12: creates a Google Doc with given markdown converted to formatted Doc
  it('T12: creates a Google Doc with given markdown content', () => {
    const createdDocs: MockDoc[] = [];

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: OUTPUT_FOLDER_ID, files: [] }])),
      documentApp: makeDocumentApp(createdDocs),
      cacheService: makeCacheService(),
    });

    const markdown = '# My Resume\n\nSome **bold** content.\n\nAnother paragraph.';
    driveOps.writeOutput(OUTPUT_FOLDER_ID, 'Test Resume', markdown);

    expect(createdDocs.length).toBeGreaterThan(0);
    expect(createdDocs[0].name).toBeTruthy();
  });

  // T13: returns docUrl matching docs.google.com/document/d/* pattern
  it('T13: returns docUrl matching docs.google.com/document/d/* pattern', () => {
    const createdDocs: MockDoc[] = [];

    setupGlobals({
      driveApp: makeDriveApp(folderMap([{ id: OUTPUT_FOLDER_ID, files: [] }])),
      documentApp: makeDocumentApp(createdDocs),
      cacheService: makeCacheService(),
    });

    const result = driveOps.writeOutput(OUTPUT_FOLDER_ID, 'Test Resume', '# Resume');

    expect(result.docUrl).toMatch(/^https:\/\/docs\.google\.com\/document\/d\/.+/);
    expect(result.docId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.readFile / writeFile
// ---------------------------------------------------------------------------

describe('DriveOps.readFile / writeFile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const FILE_ID = 'file-read-write-001';
  const fileData = mockMdFile('my-resume.md', '# My Resume\n\nExperience here.', {
    id: FILE_ID,
    lastUpdated: 1_700_000_000_000,
  });

  // T14: readFile returns FileEntry shape
  it('T14: readFile returns FileEntry shape', () => {
    setupGlobals({
      driveApp: makeDriveApp({}, { [FILE_ID]: fileData }),
      cacheService: makeCacheService(),
    });

    const entry = driveOps.readFile(FILE_ID);

    expect(entry.fileId).toBe(FILE_ID);
    expect(entry.name).toBe('my-resume.md');
    expect(entry.contents).toBe('# My Resume\n\nExperience here.');
    expect(typeof entry.tokens).toBe('number');
    expect(entry.tokens).toBeGreaterThan(0);
    expect(typeof entry.lastModifiedAt).toBe('number');
  });

  // T15: writeFile updates contents and returns updatedAt
  it('T15: writeFile updates contents and returns updatedAt', () => {
    const mutableFile = mockMdFile('my-resume.md', 'Original content', { id: FILE_ID });

    setupGlobals({
      driveApp: makeDriveApp({}, { [FILE_ID]: mutableFile }),
      cacheService: makeCacheService(),
    });

    const newContents = 'Updated content with **bold** text.';
    const result = driveOps.writeFile(FILE_ID, newContents);

    expect(typeof result.updatedAt).toBe('number');
    expect(result.updatedAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.replaceDocContents
// ---------------------------------------------------------------------------

describe('DriveOps.replaceDocContents', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // T19: clears existing body and re-renders the new markdown (headings + paragraphs)
  it('T19: clears existing body and re-renders the new markdown (headings + paragraphs)', () => {
    const createdDocs: MockDoc[] = [];
    const documentApp = makeDocumentApp(createdDocs);

    // Pre-create a doc we can open by id
    const existingDocId = 'existing-doc-001';
    const existingDoc: MockDoc = { id: existingDocId, name: 'tailored_resume', body: 'Old content' };
    createdDocs.push(existingDoc);

    // Intercept clear() on the body
    let clearCalled = false;
    const originalOpenById = documentApp.openById.getMockImplementation?.() ?? documentApp.openById;
    documentApp.openById = vi.fn((id: string) => {
      if (id !== existingDocId) throw new Error(`Doc not found: ${id}`);
      return {
        getId: () => existingDoc.id,
        getUrl: () => `https://docs.google.com/document/d/${existingDoc.id}/edit`,
        getBody: () => ({
          clear: vi.fn(() => { clearCalled = true; existingDoc.body = ''; }),
          setText: vi.fn((text: string) => { existingDoc.body = text; }),
          appendParagraph: vi.fn((text: string) => {
            existingDoc.body += (existingDoc.body ? '\n' : '') + text;
            return { setHeading: vi.fn() };
          }),
        }),
        saveAndClose: vi.fn(),
      };
    });

    setupGlobals({ documentApp });

    const markdown = '# My Resume\n\n## Experience\n\nSome content here.';
    driveOps.replaceDocContents(existingDocId, markdown);

    expect(clearCalled).toBe(true);
    // Body should contain the rendered markdown content
    expect(existingDoc.body).toContain('My Resume');
    expect(existingDoc.body).toContain('Experience');
    expect(existingDoc.body).toContain('Some content here.');
  });

  // T20: handles empty markdown (clears doc, no error)
  it('T20: handles empty markdown (clears doc, no error)', () => {
    const createdDocs: MockDoc[] = [];
    const documentApp = makeDocumentApp(createdDocs);

    const existingDocId = 'existing-doc-002';
    const existingDoc: MockDoc = { id: existingDocId, name: 'tailored_resume', body: 'Old content' };
    createdDocs.push(existingDoc);

    let clearCalled = false;
    documentApp.openById = vi.fn((id: string) => {
      if (id !== existingDocId) throw new Error(`Doc not found: ${id}`);
      return {
        getId: () => existingDoc.id,
        getUrl: () => `https://docs.google.com/document/d/${existingDoc.id}/edit`,
        getBody: () => ({
          clear: vi.fn(() => { clearCalled = true; existingDoc.body = ''; }),
          setText: vi.fn((text: string) => { existingDoc.body = text; }),
          appendParagraph: vi.fn((text: string) => {
            existingDoc.body += (existingDoc.body ? '\n' : '') + text;
            return { setHeading: vi.fn() };
          }),
        }),
        saveAndClose: vi.fn(),
      };
    });

    setupGlobals({ documentApp });

    expect(() => driveOps.replaceDocContents(existingDocId, '')).not.toThrow();
    expect(clearCalled).toBe(true);
  });

  // T21: invokes saveAndClose to persist
  it('T21: invokes saveAndClose to persist', () => {
    const createdDocs: MockDoc[] = [];
    const documentApp = makeDocumentApp(createdDocs);

    const existingDocId = 'existing-doc-003';
    const existingDoc: MockDoc = { id: existingDocId, name: 'tailored_resume', body: '' };
    createdDocs.push(existingDoc);

    const saveAndClose = vi.fn();
    documentApp.openById = vi.fn((id: string) => {
      if (id !== existingDocId) throw new Error(`Doc not found: ${id}`);
      return {
        getId: () => existingDoc.id,
        getUrl: () => `https://docs.google.com/document/d/${existingDoc.id}/edit`,
        getBody: () => ({
          clear: vi.fn(),
          setText: vi.fn(),
          appendParagraph: vi.fn(() => ({ setHeading: vi.fn() })),
        }),
        saveAndClose,
      };
    });

    setupGlobals({ documentApp });

    driveOps.replaceDocContents(existingDocId, '# Resume');
    expect(saveAndClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.exportDocAs
// ---------------------------------------------------------------------------

describe('DriveOps.exportDocAs', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const DOC_ID = 'doc-to-export-001';
  const JOB_FOLDER_ID = 'job-folder-export-001';

  /** Build a DriveApp stub whose getFolderById always returns the SAME folder object. */
  function makeExportDriveApp(createFileFn: ReturnType<typeof vi.fn>) {
    const folderStub = { createFile: createFileFn };
    return { getFolderById: vi.fn((_id: string) => folderStub) };
  }

  // T22: builds correct export URL for docx and POSTs with OAuth bearer token
  it('T22: builds correct export URL for docx and uses OAuth bearer token', () => {
    const capturedRequests: Array<{ url: string; options: Record<string, unknown> }> = [];
    const mockBlob = { setName: vi.fn() };

    const urlFetchApp = {
      fetch: vi.fn((url: string, options: Record<string, unknown>) => {
        capturedRequests.push({ url, options });
        return { getResponseCode: () => 200, getBlob: () => mockBlob };
      }),
    };

    const createFile = vi.fn(() => ({
      getId: () => 'exported-docx-001',
      getUrl: () => 'https://drive.google.com/file/d/exported-docx-001/view',
    }));

    vi.stubGlobal('UrlFetchApp', urlFetchApp);
    vi.stubGlobal('DriveApp', makeExportDriveApp(createFile));
    vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'mock-oauth-token' });

    driveOps.exportDocAs(DOC_ID, JOB_FOLDER_ID, 'docx', 'final_resume.docx');

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].url).toBe(
      `https://docs.google.com/document/d/${DOC_ID}/export?format=docx`,
    );
    const headers = capturedRequests[0].options['headers'] as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer mock-oauth-token');
  });

  // T23: builds correct export URL for pdf
  it('T23: builds correct export URL for pdf', () => {
    const capturedUrls: string[] = [];

    const urlFetchApp = {
      fetch: vi.fn((url: string, _opts: unknown) => {
        capturedUrls.push(url);
        return { getResponseCode: () => 200, getBlob: () => ({ setName: vi.fn() }) };
      }),
    };

    const createFile = vi.fn(() => ({
      getId: () => 'pdf-file-001',
      getUrl: () => 'https://drive.google.com/file/d/pdf-file-001/view',
    }));

    vi.stubGlobal('UrlFetchApp', urlFetchApp);
    vi.stubGlobal('DriveApp', makeExportDriveApp(createFile));
    vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'mock-token' });

    driveOps.exportDocAs(DOC_ID, JOB_FOLDER_ID, 'pdf', 'final_resume.pdf');

    expect(capturedUrls[0]).toBe(
      `https://docs.google.com/document/d/${DOC_ID}/export?format=pdf`,
    );
  });

  // T24: saves the resulting blob in the job folder with the given fileName
  it('T24: saves the resulting blob in the job folder with the given fileName', () => {
    const blobSetNameCalls: string[] = [];
    const mockBlob = { setName: vi.fn((n: string) => { blobSetNameCalls.push(n); }) };

    const urlFetchApp = {
      fetch: vi.fn((_url: string, _opts: unknown) => ({
        getResponseCode: () => 200,
        getBlob: () => mockBlob,
      })),
    };

    const createFile = vi.fn(() => ({
      getId: () => 'created-file-001',
      getUrl: () => 'https://drive.google.com/file/d/created-file-001/view',
    }));

    vi.stubGlobal('UrlFetchApp', urlFetchApp);
    vi.stubGlobal('DriveApp', makeExportDriveApp(createFile));
    vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'tok' });

    driveOps.exportDocAs(DOC_ID, JOB_FOLDER_ID, 'docx', 'final_resume.docx');

    expect(blobSetNameCalls).toContain('final_resume.docx');
    expect(createFile).toHaveBeenCalledOnce();
  });

  // T25: returns { fileId, url, fileName }
  it('T25: returns { fileId, url, fileName }', () => {
    const urlFetchApp = {
      fetch: vi.fn(() => ({
        getResponseCode: () => 200,
        getBlob: () => ({ setName: vi.fn() }),
      })),
    };

    const createFile = vi.fn(() => ({
      getId: () => 'result-file-001',
      getUrl: () => 'https://drive.google.com/file/d/result-file-001/view',
    }));

    vi.stubGlobal('UrlFetchApp', urlFetchApp);
    vi.stubGlobal('DriveApp', makeExportDriveApp(createFile));
    vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'tok' });

    const result = driveOps.exportDocAs(DOC_ID, JOB_FOLDER_ID, 'docx', 'final_resume.docx');

    expect(result.fileId).toBe('result-file-001');
    expect(result.url).toBe('https://drive.google.com/file/d/result-file-001/view');
    expect(result.fileName).toBe('final_resume.docx');
  });

  // T26: throws on non-200 from the export endpoint
  it('T26: throws on non-200 from the export endpoint', () => {
    const urlFetchApp = {
      fetch: vi.fn(() => ({
        getResponseCode: () => 403,
        getBlob: () => ({ setName: vi.fn() }),
      })),
    };

    vi.stubGlobal('UrlFetchApp', urlFetchApp);
    vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'tok' });

    expect(() =>
      driveOps.exportDocAs(DOC_ID, JOB_FOLDER_ID, 'docx', 'final_resume.docx'),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// describe: DriveOps.appendSheetRow
// ---------------------------------------------------------------------------

describe('DriveOps.appendSheetRow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const sampleRow = {
    date: '2026-05-09T12:00:00.000Z',
    company: 'Acme Corp',
    role: 'Senior Engineer',
    url: 'https://jobs.example.com/123',
    docUrl: 'https://docs.google.com/document/d/doc-abc/edit',
    modelUsed: 'claude-haiku-4-5',
    costUsd: 0.0042,
    keywordMatchRate: 0.85,
    notes: 'Great fit',
  };

  // T16: appends row with correct columns
  it('T16: appends row with correct columns: date, company, role, url, docUrl, modelUsed, costUsd, keywordMatchRate, notes', () => {
    const spreadsheets = {
      [SHEET_ID]: {
        id: SHEET_ID,
        sheets: {
          'Applications': { name: 'Applications', rows: [
            // Existing header row
            ['Date', 'Company', 'Role', 'URL', 'Doc URL', 'Model', 'Cost USD', 'Keyword Match Rate', 'Notes'],
          ]},
        },
      },
    };

    setupGlobals({
      spreadsheetApp: makeSpreadsheetApp(spreadsheets),
      cacheService: makeCacheService(),
    });

    driveOps.appendSheetRow(SHEET_ID, sampleRow);

    const sheet = spreadsheets[SHEET_ID].sheets['Applications'];
    // Should have header row + 1 data row
    expect(sheet.rows.length).toBeGreaterThanOrEqual(2);

    const dataRow = sheet.rows[sheet.rows.length - 1] as string[];
    expect(dataRow).toContain(sampleRow.date);
    expect(dataRow).toContain(sampleRow.company);
    expect(dataRow).toContain(sampleRow.role);
    expect(dataRow).toContain(sampleRow.url);
    expect(dataRow).toContain(sampleRow.docUrl);
    expect(dataRow).toContain(sampleRow.modelUsed);
    expect(dataRow).toContain(sampleRow.costUsd);
    expect(dataRow).toContain(sampleRow.keywordMatchRate);
  });

  // T17: creates header row if sheet is empty
  it('T17: creates header row if sheet is empty', () => {
    const spreadsheets = {
      [SHEET_ID]: {
        id: SHEET_ID,
        sheets: {
          'Applications': { name: 'Applications', rows: [] },
        },
      },
    };

    setupGlobals({
      spreadsheetApp: makeSpreadsheetApp(spreadsheets),
      cacheService: makeCacheService(),
    });

    driveOps.appendSheetRow(SHEET_ID, sampleRow);

    const sheet = spreadsheets[SHEET_ID].sheets['Applications'];
    // First row should be a header row
    expect(sheet.rows.length).toBe(2);
    const headerRow = sheet.rows[0] as string[];
    // Header should contain expected column names
    expect(headerRow.some(h => typeof h === 'string' && h.toLowerCase().includes('date'))).toBe(true);
    expect(headerRow.some(h => typeof h === 'string' && h.toLowerCase().includes('company'))).toBe(true);
    expect(headerRow.some(h => typeof h === 'string' && h.toLowerCase().includes('role'))).toBe(true);
  });

  // T18: returns rowIndex and rowUrl with #gid+row anchor
  it('T18: returns rowIndex and rowUrl with #gid+row anchor', () => {
    const spreadsheets = {
      [SHEET_ID]: {
        id: SHEET_ID,
        sheets: {
          'Applications': { name: 'Applications', rows: [
            ['Date', 'Company', 'Role', 'URL', 'Doc URL', 'Model', 'Cost USD', 'Keyword Match Rate', 'Notes'],
          ]},
        },
      },
    };

    setupGlobals({
      spreadsheetApp: makeSpreadsheetApp(spreadsheets),
      cacheService: makeCacheService(),
    });

    const result = driveOps.appendSheetRow(SHEET_ID, sampleRow);

    expect(typeof result.rowIndex).toBe('number');
    expect(result.rowIndex).toBeGreaterThan(0);
    expect(result.rowUrl).toMatch(/docs\.google\.com\/spreadsheets/);
    // Should contain a gid/row anchor
    expect(result.rowUrl).toMatch(/#gid=\d+/);
  });
});
