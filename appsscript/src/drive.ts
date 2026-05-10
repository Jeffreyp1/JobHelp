/**
 * Drive operations for JobHelp Apps Script backend.
 * Implements the DriveOps interface from types/drive-ops.ts.
 *
 * All GAS globals (DriveApp, SpreadsheetApp, UrlFetchApp, CacheService, DocumentApp)
 * are accessed via globalThis so they can be replaced with mocks in Vitest.
 */

import type {
  DriveOps,
  FileEntry,
  ConcatenatedSourceMaterials,
  SheetRow,
} from './types/drive-ops.js';

// ---------------------------------------------------------------------------
// GAS global accessors (via globalThis so tests can stub them)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function gasGlobal<T>(name: string): T {
  return (globalThis as any)[name] as T;
}

function getDriveApp(): any        { return gasGlobal<any>('DriveApp'); }
function getSpreadsheetApp(): any  { return gasGlobal<any>('SpreadsheetApp'); }
function getUrlFetchApp(): any     { return gasGlobal<any>('UrlFetchApp'); }
function getCacheService(): any    { return gasGlobal<any>('CacheService'); }
function getDocumentApp(): any     { return gasGlobal<any>('DocumentApp'); }
function getScriptApp(): any       { return gasGlobal<any>('ScriptApp'); }
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MD_MIME_TYPE = 'text/markdown';
const CACHE_TTL_SECONDS = 600; // 10 minutes
const SHEET_NAME = 'Applications';

const HEADER_ROW = [
  'Date',
  'Status',          // user-filled: Applied / Screen / Interview / Offer / Rejected / Ghosted
  'Company',
  'Role',
  'Location',
  'Salary',
  'Source',          // auto: LinkedIn / Indeed / Greenhouse / Lever / Workday / Ashby / Direct
  'Job URL',
  'Folder URL',
  'Resume Doc',
  'Final DOCX',      // filled by Convert to DOCX
  'Final PDF',       // filled by Convert to PDF
  'Match Rate',
  'Cost USD',
  'Model',
  'Recruiter',       // user-filled
  'Follow-up',       // user-filled
  'Notes',
];

/**
 * Format a Date as "May 9, 2026".
 * Uses en-US conventions for consistency across users.
 */
function formatDateReadable(d: Date): string {
  // Avoid Intl in Apps Script V8 environments where it may behave oddly;
  // hand-roll for full control.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Token estimator (chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter delimited by --- ... ---.
 * Returns a Record of key: value pairs (all as strings).
 */
function parseFrontmatter(contents: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;

  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// File reader helpers
// ---------------------------------------------------------------------------

function fileToEntry(file: any, parseFm = false): FileEntry {
  // Google Docs can't be read as a Blob directly — extract via DocumentApp.
  let contents: string;
  const mimeType = typeof file.getMimeType === 'function' ? file.getMimeType() : '';
  if (mimeType === 'application/vnd.google-apps.document') {
    try {
      const DocumentApp = getDocumentApp();
      contents = DocumentApp.openById(file.getId()).getBody().getText();
    } catch {
      // Fall back to blob read; will likely be empty/garbage but won't crash
      contents = file.getBlob().getDataAsString();
    }
  } else {
    contents = file.getBlob().getDataAsString();
  }
  const lastUpdated: Date = file.getLastUpdated();
  const lastModifiedAt = lastUpdated instanceof Date
    ? lastUpdated.getTime()
    : Number(lastUpdated);

  const entry: FileEntry = {
    name: file.getName(),
    fileId: file.getId(),
    contents,
    tokens: estimateTokens(contents),
    lastModifiedAt,
  };

  if (parseFm) {
    const fm = parseFrontmatter(contents);
    entry.loadBearing = fm['load_bearing'] === 'true';
  }

  return entry;
}

/**
 * Read all .md files from a folder, sorted alphabetically.
 * Throws if folderId is invalid.
 *
 * NOTE: We can't filter by MIME type because Drive often tags uploaded
 * .md files as text/plain or application/octet-stream rather than
 * text/markdown. We iterate ALL files in the folder and filter by
 * filename extension instead. We also accept Google Docs (Drive often
 * converts .md to a native Doc on upload) by reading their text content.
 */
function readMdFilesFromFolder(folderId: string, parseFm = false): FileEntry[] {
  const DriveApp = getDriveApp();
  const folder = DriveApp.getFolderById(folderId); // throws if invalid
  const iterator = folder.getFiles();

  const entries: FileEntry[] = [];
  while (iterator.hasNext()) {
    const file = iterator.next();
    const name = file.getName();
    const mimeType = typeof file.getMimeType === 'function' ? file.getMimeType() : '';

    // Accept any of:
    //   • Filename ending in .md (most common — Drive often tags as text/plain or octet-stream)
    //   • MIME type text/markdown / text/x-markdown (rare but explicit)
    //   • Native Google Doc named like a markdown file (.md or no extension)
    //     — Drive sometimes converts uploads; we read via DocumentApp.
    const lowerName = name.toLowerCase();
    const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
    const isMd =
      lowerName.endsWith('.md') ||
      mimeType === 'text/markdown' ||
      mimeType === 'text/x-markdown' ||
      // Google Doc with .md in its name (or matching our seeded filenames)
      (isGoogleDoc && (lowerName.endsWith('.md') || /^\d{2}-/.test(lowerName)));

    if (!isMd) continue;

    entries.push(fileToEntry(file, parseFm));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function getCache() {
  return getCacheService().getScriptCache();
}

function cacheGet<T>(key: string): T | null {
  const raw = getCache().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function cachePut(key: string, value: unknown): void {
  getCache().put(key, JSON.stringify(value), CACHE_TTL_SECONDS);
}

// ---------------------------------------------------------------------------
// Markdown → Doc line renderer (shared by writeOutput, writeJobOutput, replaceDocContents)
// ---------------------------------------------------------------------------

/**
 * Render markdown lines into the given Doc body.
 * Handles H1/H2/H3 headings and ordinary paragraphs.
 * The caller must clear/prime the body before calling this.
 */
function renderMarkdownToBody(body: any, DocumentApp: any, markdownContent: string): void {
  const lines = markdownContent.split('\n');
  let firstParagraph = true;

  for (const line of lines) {
    if (line.startsWith('# ')) {
      const para = body.appendParagraph(line.slice(2));
      if (typeof para.setHeading === 'function') {
        para.setHeading(DocumentApp.ParagraphHeading?.HEADING1 ?? 'HEADING1');
      }
      firstParagraph = false;
    } else if (line.startsWith('## ')) {
      const para = body.appendParagraph(line.slice(3));
      if (typeof para.setHeading === 'function') {
        para.setHeading(DocumentApp.ParagraphHeading?.HEADING2 ?? 'HEADING2');
      }
      firstParagraph = false;
    } else if (line.startsWith('### ')) {
      const para = body.appendParagraph(line.slice(4));
      if (typeof para.setHeading === 'function') {
        para.setHeading(DocumentApp.ParagraphHeading?.HEADING3 ?? 'HEADING3');
      }
      firstParagraph = false;
    } else if (firstParagraph) {
      body.setText(line);
      firstParagraph = false;
    } else {
      body.appendParagraph(line);
    }
  }
}

// ---------------------------------------------------------------------------
// DriveOps implementation
// ---------------------------------------------------------------------------

export const driveOps: DriveOps = {
  // -------------------------------------------------------------------------
  // readSourceFiles
  // -------------------------------------------------------------------------
  readSourceFiles(folderId: string): ConcatenatedSourceMaterials {
    const cacheKey = `readSourceFiles:${folderId}`;
    const cached = cacheGet<ConcatenatedSourceMaterials>(cacheKey);
    if (cached) return cached;

    const files = readMdFilesFromFolder(folderId, false);

    let text = '';
    if (files.length > 0) {
      text = files
        .map(f => `=== ${f.name} ===\n\n${f.contents}`)
        .join('\n\n');
    }

    const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

    const result: ConcatenatedSourceMaterials = { text, files, totalTokens };
    cachePut(cacheKey, result);
    return result;
  },

  // -------------------------------------------------------------------------
  // readRuleFiles
  // -------------------------------------------------------------------------
  readRuleFiles(folderId: string): FileEntry[] {
    const cacheKey = `readRuleFiles:${folderId}`;
    const cached = cacheGet<FileEntry[]>(cacheKey);
    if (cached) {
      // If cached is empty array it should still throw (empty folder)
      if (cached.length === 0) {
        throw new Error('EmptyFolder');
      }
      return cached;
    }

    const files = readMdFilesFromFolder(folderId, true);

    if (files.length === 0) {
      throw new Error('EmptyFolder');
    }

    cachePut(cacheKey, files);
    return files;
  },

  // -------------------------------------------------------------------------
  // writeOutput
  // -------------------------------------------------------------------------
  writeOutput(
    _folderId: string,
    fileName: string,
    markdownContent: string,
  ): { docUrl: string; docId: string } {
    const DocumentApp = getDocumentApp();

    const doc = DocumentApp.create(fileName);
    const body = doc.getBody();

    // Basic markdown → Doc rendering: preserve newlines, handle bold/italic
    // We parse line-by-line to produce a readable Doc (not full CommonMark)
    const lines = markdownContent.split('\n');
    let firstParagraph = true;

    for (const line of lines) {
      if (line.startsWith('# ')) {
        const para = body.appendParagraph(line.slice(2));
        if (typeof para.setHeading === 'function') {
          para.setHeading(DocumentApp.ParagraphHeading?.HEADING1 ?? 'HEADING1');
        }
        firstParagraph = false;
      } else if (line.startsWith('## ')) {
        const para = body.appendParagraph(line.slice(3));
        if (typeof para.setHeading === 'function') {
          para.setHeading(DocumentApp.ParagraphHeading?.HEADING2 ?? 'HEADING2');
        }
        firstParagraph = false;
      } else if (line.startsWith('### ')) {
        const para = body.appendParagraph(line.slice(4));
        if (typeof para.setHeading === 'function') {
          para.setHeading(DocumentApp.ParagraphHeading?.HEADING3 ?? 'HEADING3');
        }
        firstParagraph = false;
      } else if (firstParagraph) {
        body.setText(line);
        firstParagraph = false;
      } else {
        body.appendParagraph(line);
      }
    }

    if (typeof doc.saveAndClose === 'function') {
      doc.saveAndClose();
    }

    const docId: string = doc.getId();
    const docUrl: string = doc.getUrl();

    return { docUrl, docId };
  },

  // -------------------------------------------------------------------------
  // writeJobOutput
  // -------------------------------------------------------------------------
  writeJobOutput(
    parentFolderId: string,
    jobFolderName: string,
    markdownContent: string,
  ): {
    jobFolderId: string;
    jobFolderUrl: string;
    docId: string;
    docUrl: string;
    mdFileId: string;
    mdFileUrl: string;
  } {
    const DriveApp = getDriveApp();
    const DocumentApp = getDocumentApp();

    const parentFolder = DriveApp.getFolderById(parentFolderId);

    // Create subfolder; if name already exists, append "-2", "-3", etc.
    let folderName = jobFolderName;
    let counter = 2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findExisting = (parent: any, name: string): unknown => {
      const it = parent.getFoldersByName(name);
      return it.hasNext() ? it.next() : null;
    };
    while (findExisting(parentFolder, folderName)) {
      folderName = `${jobFolderName}-${counter}`;
      counter++;
      if (counter > 50) break; // sanity bound
    }
    const jobFolder = parentFolder.createFolder(folderName);
    const jobFolderId = jobFolder.getId();
    const jobFolderUrl = jobFolder.getUrl();

    // 1. Save raw markdown as `tailored_resume.md` text file in the job folder
    const mdFile = jobFolder.createFile(
      'tailored_resume.md',
      markdownContent,
      'text/markdown',
    );
    const mdFileId = mdFile.getId();
    const mdFileUrl = mdFile.getUrl();

    // 2. Create a Google Doc rendering of the markdown (DocumentApp creates it
    //    in My Drive root by default; we move it into the job folder afterward)
    const doc = DocumentApp.create('tailored_resume');
    const body = doc.getBody();
    const lines = markdownContent.split('\n');
    let firstParagraph = true;

    for (const line of lines) {
      if (line.startsWith('# ')) {
        const para = body.appendParagraph(line.slice(2));
        if (typeof para.setHeading === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          para.setHeading((DocumentApp as any).ParagraphHeading?.HEADING1 ?? 'HEADING1');
        }
        firstParagraph = false;
      } else if (line.startsWith('## ')) {
        const para = body.appendParagraph(line.slice(3));
        if (typeof para.setHeading === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          para.setHeading((DocumentApp as any).ParagraphHeading?.HEADING2 ?? 'HEADING2');
        }
        firstParagraph = false;
      } else if (line.startsWith('### ')) {
        const para = body.appendParagraph(line.slice(4));
        if (typeof para.setHeading === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          para.setHeading((DocumentApp as any).ParagraphHeading?.HEADING3 ?? 'HEADING3');
        }
        firstParagraph = false;
      } else if (firstParagraph) {
        body.setText(line);
        firstParagraph = false;
      } else {
        body.appendParagraph(line);
      }
    }
    if (typeof doc.saveAndClose === 'function') {
      doc.saveAndClose();
    }
    const docId: string = doc.getId();

    // Move the Google Doc from My Drive root into the job folder
    const docFile = DriveApp.getFileById(docId);
    const parents = docFile.getParents();
    while (parents.hasNext()) {
      const oldParent = parents.next();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (oldParent as any).removeFile === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (oldParent as any).removeFile(docFile);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (jobFolder as any).addFile === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (jobFolder as any).addFile(docFile);
    }
    const docUrl: string = doc.getUrl();

    return {
      jobFolderId,
      jobFolderUrl,
      docId,
      docUrl,
      mdFileId,
      mdFileUrl,
    };
  },

  // -------------------------------------------------------------------------
  // readFile
  // -------------------------------------------------------------------------
  readFile(fileId: string): FileEntry {
    const DriveApp = getDriveApp();
    const file = DriveApp.getFileById(fileId);
    return fileToEntry(file, false);
  },

  // -------------------------------------------------------------------------
  // writeFile
  // -------------------------------------------------------------------------
  writeFile(fileId: string, newContents: string): { updatedAt: number } {
    const DriveApp = getDriveApp();
    const file = DriveApp.getFileById(fileId);
    file.setContent(newContents);
    const updatedAt = Date.now();
    return { updatedAt };
  },

  // -------------------------------------------------------------------------
  // seedDefaults
  // -------------------------------------------------------------------------
  seedDefaults(
    folderId: string,
    rawBaseUrl: string,
    filenames: string[],
  ): { seeded: string[]; errors: { filename: string; reason: string }[] } {
    const DriveApp = getDriveApp();
    const UrlFetchApp = getUrlFetchApp();

    const folder = DriveApp.getFolderById(folderId);

    // Collect existing filenames in the folder to enable idempotency
    const existingFiles = new Set<string>();
    const existingIterator = folder.getFiles();
    while (existingIterator.hasNext()) {
      const f = existingIterator.next();
      existingFiles.add(f.getName());
    }

    const seeded: string[] = [];
    const errors: { filename: string; reason: string }[] = [];

    for (const filename of filenames) {
      // T11: skip if already exists
      if (existingFiles.has(filename)) {
        continue;
      }

      const url = `${rawBaseUrl}/${filename}`;
      try {
        const response = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
        const statusCode: number = response.getResponseCode();

        if (statusCode !== 200) {
          errors.push({
            filename,
            reason: `HTTP ${statusCode} from ${url}`,
          });
          continue;
        }

        const contents: string = response.getContentText();
        folder.createFile(filename, contents, MD_MIME_TYPE);
        seeded.push(filename);
      } catch (err: unknown) {
        errors.push({
          filename,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { seeded, errors };
  },

  // -------------------------------------------------------------------------
  // replaceDocContents
  // -------------------------------------------------------------------------
  replaceDocContents(docId: string, markdownContent: string): void {
    const DocumentApp = getDocumentApp();
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    // Clear the existing content
    body.clear();

    // Re-render the markdown using the shared helper
    renderMarkdownToBody(body, DocumentApp, markdownContent);

    if (typeof doc.saveAndClose === 'function') {
      doc.saveAndClose();
    }
  },

  // -------------------------------------------------------------------------
  // exportDocAs
  // -------------------------------------------------------------------------
  exportDocAs(
    docId: string,
    jobFolderId: string,
    format: 'docx' | 'pdf',
    fileName: string,
  ): { fileId: string; url: string; fileName: string } {
    const DriveApp = getDriveApp();
    const UrlFetchApp = getUrlFetchApp();
    const ScriptApp = getScriptApp();

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=${format}`;

    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: true,
    });

    const statusCode: number = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Export failed with HTTP ${statusCode} for format=${format}`);
    }

    const blob = response.getBlob();
    blob.setName(fileName);

    const jobFolder = DriveApp.getFolderById(jobFolderId);
    const createdFile = jobFolder.createFile(blob);

    const fileId: string = createdFile.getId();
    const fileUrl: string = createdFile.getUrl();

    return { fileId, url: fileUrl, fileName };
  },

  // -------------------------------------------------------------------------
  // downloadFileAsBase64
  //
  // Read a Drive file's binary contents and return base64 + name + MIME type.
  // Backbone of the template-fill flow: the extension downloads the user's
  // uploaded template DOCX, fills it client-side, then re-uploads.
  // -------------------------------------------------------------------------
  downloadFileAsBase64(fileId: string): {
    base64: string;
    fileName: string;
    mimeType: string;
  } {
    const DriveApp = getDriveApp();
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const bytes: number[] = blob.getBytes();
    // Apps Script ships Utilities.base64Encode globally; in tests we fall
    // back to the Buffer API.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const Utilities = (globalThis as any).Utilities as
      | { base64Encode: (bytes: number[]) => string }
      | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    let base64: string;
    if (Utilities && typeof Utilities.base64Encode === 'function') {
      base64 = Utilities.base64Encode(bytes);
    } else {
      // Test fallback — bytes is a number[] of signed bytes per GAS convention.
      const buf = Buffer.from(Uint8Array.from(bytes));
      base64 = buf.toString('base64');
    }

    const mimeType: string =
      typeof file.getMimeType === 'function' ? file.getMimeType() : '';

    return {
      base64,
      fileName: file.getName(),
      mimeType,
    };
  },

  // -------------------------------------------------------------------------
  // uploadDocxFromBase64
  //
  // Counterpart to downloadFileAsBase64: decode incoming base64 bytes into a
  // DOCX-typed Drive file inside the requested folder. Used by the
  // "Convert via Template (DOCX)" flow once the client has filled the template.
  // -------------------------------------------------------------------------
  uploadDocxFromBase64(
    folderId: string,
    fileName: string,
    base64: string,
  ): { fileId: string; url: string; fileName: string } {
    const DriveApp = getDriveApp();
    const folder = DriveApp.getFolderById(folderId);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const Utilities = (globalThis as any).Utilities as
      | {
          base64Decode: (s: string) => number[];
          newBlob: (data: number[], mimeType: string, name: string) => any;
        }
      | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const DOCX_MIME =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    let createdFile: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (Utilities && typeof Utilities.base64Decode === 'function') {
      const bytes = Utilities.base64Decode(base64);
      const blob = Utilities.newBlob(bytes, DOCX_MIME, fileName);
      createdFile = folder.createFile(blob);
    } else {
      // Test fallback: drop the bytes through Buffer + a synthetic blob.
      const buf = Buffer.from(base64, 'base64');
      const fakeBlob = {
        getBytes: () => Array.from(buf),
        getName: () => fileName,
        setName: (n: string) => fileName = n,
        getContentType: () => DOCX_MIME,
      };
      createdFile = folder.createFile(fakeBlob);
    }

    return {
      fileId: createdFile.getId(),
      url: createdFile.getUrl(),
      fileName,
    };
  },

  // -------------------------------------------------------------------------
  // appendSheetRow
  // -------------------------------------------------------------------------
  appendSheetRow(
    sheetId: string,
    row: SheetRow,
  ): { rowIndex: number; rowUrl: string } {
    const SpreadsheetApp = getSpreadsheetApp();
    const ss = SpreadsheetApp.openById(sheetId);

    let sheet = ss.getSheetByName(SHEET_NAME);
    let isNew = false;

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      isNew = true;
    }

    // T17: create header row if sheet is empty
    const lastRow: number = sheet.getLastRow();
    if (lastRow === 0 || isNew) {
      sheet.appendRow(HEADER_ROW);
    }

    const dataRow = [
      row.date,
      '',                              // Status — user-filled
      row.company ?? '',
      row.role ?? '',
      row.location ?? '',
      row.salary ?? '',
      row.source ?? '',
      row.url,
      row.folderUrl ?? '',
      row.docUrl,
      row.finalDocxUrl ?? '',
      row.finalPdfUrl ?? '',
      row.keywordMatchRate,
      row.costUsd,
      row.modelUsed,
      '',                              // Recruiter — user-filled
      '',                              // Follow-up — user-filled
      row.notes ?? '',
    ];

    sheet.appendRow(dataRow);

    const rowIndex: number = sheet.getLastRow();
    const gid: number = sheet.getSheetId();
    const ssUrl: string = ss.getUrl();

    // T18: rowUrl with #gid+row anchor
    const rowUrl = `${ssUrl}#gid=${gid}&range=A${rowIndex}`;

    return { rowIndex, rowUrl };
  },
};
