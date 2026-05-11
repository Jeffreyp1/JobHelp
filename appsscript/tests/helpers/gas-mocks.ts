/**
 * Reusable Google Apps Script (GAS) global mocks for Vitest.
 * Use vi.stubGlobal('DriveApp', makeDriveApp(...)) etc. in beforeEach.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Types that mirror GAS interfaces (no @types/google-apps-script needed)
// ---------------------------------------------------------------------------

export interface MockFile {
  id: string;
  name: string;
  contents: string;
  mimeType: string;
  lastUpdated: number; // ms epoch
}

export interface MockSheet {
  name: string;
  rows: unknown[][];
}

export interface MockSpreadsheet {
  id: string;
  sheets: Record<string, MockSheet>;
}

export interface MockDoc {
  id: string;
  name: string;
  body: string;
}

// ---------------------------------------------------------------------------
// DriveApp mock
// ---------------------------------------------------------------------------

export function makeDriveApp(
  folders: Record<string, MockFile[]>,
  singleFiles: Record<string, MockFile> = {},
) {
  const makeFileObj = (f: MockFile) => ({
    getId: () => f.id,
    getName: () => f.name,
    getBlob: () => ({ getDataAsString: () => f.contents }),
    setContent: (c: string) => { f.contents = c; },
    getLastUpdated: () => new Date(f.lastUpdated),
    getMimeType: () => f.mimeType,
  });

  const makeFileIterator = (files: MockFile[]) => {
    let idx = 0;
    return {
      hasNext: () => idx < files.length,
      next: () => makeFileObj(files[idx++]),
    };
  };

  return {
    getFolderById: vi.fn((id: string) => {
      if (!(id in folders)) throw new Error(`Folder not found: ${id}`);
      const files = folders[id];
      return {
        getId: () => id,
        getFilesByType: vi.fn((_mime: string) => {
          // Filter by mime type
          const filtered = files.filter(f => f.mimeType === _mime);
          return makeFileIterator(filtered);
        }),
        getFiles: vi.fn(() => makeFileIterator(files)),
        createFile: vi.fn((name: string, contents: string, mimeType: string) => {
          const newFile: MockFile = {
            id: `file-${Date.now()}-${Math.random()}`,
            name,
            contents,
            mimeType: mimeType ?? 'text/plain',
            lastUpdated: Date.now(),
          };
          files.push(newFile);
          return makeFileObj(newFile);
        }),
      };
    }),
    getFileById: vi.fn((id: string) => {
      const f = singleFiles[id];
      if (!f) throw new Error(`File not found: ${id}`);
      return makeFileObj(f);
    }),
  };
}

// ---------------------------------------------------------------------------
// SpreadsheetApp mock
// ---------------------------------------------------------------------------

export function makeSpreadsheetApp(spreadsheets: Record<string, MockSpreadsheet>) {
  const makeSheetObj = (sheet: MockSheet, ssId: string, sheetIndex: number) => ({
    getName: () => sheet.name,
    getLastRow: () => sheet.rows.length,
    appendRow: vi.fn((row: unknown[]) => { sheet.rows.push(row); }),
    getRange: vi.fn((row: number, col: number, numRows?: number, numCols?: number) => ({
      getValues: () => sheet.rows.slice(row - 1, row - 1 + (numRows ?? 1)),
      // Single-cell setter used by updateSheetRow. The mock stores rows as
      // unknown[][]; we lazily widen the target row to col-1 with '' so that
      // updates to columns beyond the row's current length still work even
      // if the data row was appended with fewer values.
      setValue: vi.fn((value: unknown) => {
        const rowIdx = row - 1;
        if (rowIdx < 0) return;
        // Ensure the row exists
        while (sheet.rows.length <= rowIdx) sheet.rows.push([]);
        const target = sheet.rows[rowIdx];
        while (target.length < col) target.push('');
        target[col - 1] = value;
      }),
      setValues: vi.fn((values: unknown[][]) => {
        for (let r = 0; r < values.length; r++) {
          const rowIdx = row - 1 + r;
          while (sheet.rows.length <= rowIdx) sheet.rows.push([]);
          const target = sheet.rows[rowIdx];
          for (let c = 0; c < values[r].length; c++) {
            while (target.length < col + c) target.push('');
            target[col - 1 + c] = values[r][c];
          }
        }
      }),
    })),
    getSheetId: () => sheetIndex,
  });

  return {
    openById: vi.fn((id: string) => {
      const ss = spreadsheets[id];
      if (!ss) throw new Error(`Spreadsheet not found: ${id}`);
      return {
        getSheetByName: vi.fn((name: string) => {
          const sheetData = ss.sheets[name];
          if (!sheetData) return null;
          const idx = Object.keys(ss.sheets).indexOf(name);
          return makeSheetObj(sheetData, ss.id, idx);
        }),
        insertSheet: vi.fn((name: string) => {
          ss.sheets[name] = { name, rows: [] };
          const idx = Object.keys(ss.sheets).indexOf(name);
          return makeSheetObj(ss.sheets[name], ss.id, idx);
        }),
        getUrl: () => `https://docs.google.com/spreadsheets/d/${ss.id}/edit`,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// UrlFetchApp mock
// ---------------------------------------------------------------------------

export type MockFetchResponse = {
  status: number;
  body: string;
};

export function makeUrlFetchApp(
  responses: Record<string, MockFetchResponse>,
  defaultResponse?: MockFetchResponse,
) {
  return {
    fetch: vi.fn((url: string, _options?: object) => {
      const resp = responses[url] ?? defaultResponse ?? { status: 404, body: 'Not Found' };
      return {
        getResponseCode: () => resp.status,
        getContentText: () => resp.body,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// CacheService mock
// ---------------------------------------------------------------------------

export function makeCacheService(initialData: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initialData };

  const cache = {
    get: vi.fn((key: string) => store[key] ?? null),
    put: vi.fn((key: string, value: string, _ttlSeconds?: number) => {
      store[key] = value;
    }),
    remove: vi.fn((key: string) => { delete store[key]; }),
    _store: store,
  };

  return {
    getScriptCache: vi.fn(() => cache),
  };
}

// ---------------------------------------------------------------------------
// DocumentApp mock
// ---------------------------------------------------------------------------

export function makeDocumentApp(createdDocs: MockDoc[] = []) {
  return {
    create: vi.fn((name: string) => {
      const doc: MockDoc = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        body: '',
      };
      createdDocs.push(doc);
      return {
        getId: () => doc.id,
        getUrl: () => `https://docs.google.com/document/d/${doc.id}/edit`,
        getBody: () => ({
          setText: vi.fn((text: string) => { doc.body = text; }),
          appendParagraph: vi.fn((text: string) => {
            doc.body += (doc.body ? '\n' : '') + text;
            return { setHeading: vi.fn() };
          }),
          getParagraphs: vi.fn(() => []),
        }),
        saveAndClose: vi.fn(),
        setName: vi.fn((n: string) => { doc.name = n; }),
      };
    }),
    openById: vi.fn((id: string) => {
      const doc = createdDocs.find(d => d.id === id);
      if (!doc) throw new Error(`Doc not found: ${id}`);
      return {
        getId: () => doc.id,
        getUrl: () => `https://docs.google.com/document/d/${doc.id}/edit`,
        getBody: () => ({
          setText: vi.fn((text: string) => { doc.body = text; }),
          appendParagraph: vi.fn((text: string) => {
            doc.body += (doc.body ? '\n' : '') + text;
            return { setHeading: vi.fn() };
          }),
        }),
        saveAndClose: vi.fn(),
      };
    }),
    ParagraphHeading: { HEADING1: 'HEADING1', HEADING2: 'HEADING2', HEADING3: 'HEADING3', NORMAL: 'NORMAL' },
  };
}

// ---------------------------------------------------------------------------
// DriveApp.getFolderById -- factory to create folder IDs mapped to file sets
// ---------------------------------------------------------------------------

/** Convenience: build a map of folderId → MockFile[] from an array of tuples */
export function folderMap(
  entries: Array<{ id: string; files: MockFile[] }>,
): Record<string, MockFile[]> {
  return Object.fromEntries(entries.map(e => [e.id, e.files]));
}

/** Convenience: create a MockFile with defaults */
export function mockMdFile(
  name: string,
  contents: string,
  overrides: Partial<MockFile> = {},
): MockFile {
  return {
    id: `file-${name.replace(/\W/g, '_')}`,
    name,
    contents,
    mimeType: 'text/markdown',
    lastUpdated: 1_700_000_000_000,
    ...overrides,
  };
}

export function mockTextFile(
  name: string,
  contents: string,
  mimeType = 'text/plain',
  overrides: Partial<MockFile> = {},
): MockFile {
  return {
    id: `file-${name.replace(/\W/g, '_')}`,
    name,
    contents,
    mimeType,
    lastUpdated: 1_700_000_000_000,
    ...overrides,
  };
}
