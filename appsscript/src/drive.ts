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
import type { JobPipelineRow, JobPipelineStatus, JobSource } from './types/job-discovery.js';
import { log } from './lib/structuredLog.js';

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
  // ---- v2 feature columns (left blank by appendSheetRow; filled by
  // v2 handlers via updateSheetRow). New columns are always appended at the
  // end so existing rows / sheets remain layout-compatible. ----
  'Critique Score',          // 0-10 weighted score from `critique` handler
  'Cover Letter URL',        // doc URL from `cover_letter` handler
  'Verify Unverified Count', // unverified entity count from `verify_cl_hooks`
  'Multi-Version Label',     // label of variant kept from `multi_version`
];

/**
 * Column index (1-based, GAS convention) of every SheetRow field in the
 * tracking sheet. Kept in sync with HEADER_ROW above. Used by updateSheetRow
 * to write specific cells without disturbing the rest of the row.
 */
const COLUMN_INDEX: Record<keyof SheetRow, number> = {
  date: 1,
  // status (col 2) is user-filled — not in SheetRow
  company: 3,
  role: 4,
  location: 5,
  salary: 6,
  source: 7,
  url: 8,
  folderUrl: 9,
  docUrl: 10,
  finalDocxUrl: 11,
  finalPdfUrl: 12,
  keywordMatchRate: 13,
  costUsd: 14,
  modelUsed: 15,
  // recruiter (col 16) + follow-up (col 17) are user-filled
  notes: 18,
  critiqueScore: 19,
  coverLetterUrl: 20,
  verifyHookUnverifiedCount: 21,
  multiVersionLabel: 22,
};

// ---------------------------------------------------------------------------
// Job Pipeline sheet (Phase 1 auto-apply)
// ---------------------------------------------------------------------------

const JOB_PIPELINE_SHEET_NAME = 'Job Pipeline';

const JOB_PIPELINE_HEADER = [
  'Job ID',
  'Discovered',
  'Posted',
  'Source',
  'Company',
  'Title',
  'Location',
  'URL',
  'Score',
  'Matched Skills',
  'Missing Skills',
  'Status',
  'Tailored Doc',
  'Notes',
];

/** 1-based column indices into JOB_PIPELINE_HEADER. */
const JP_COL = {
  jobId: 1,
  discovered: 2,
  posted: 3,
  source: 4,
  company: 5,
  title: 6,
  location: 7,
  url: 8,
  score: 9,
  matchedSkills: 10,
  missingSkills: 11,
  status: 12,
  tailoredDoc: 13,
  notes: 14,
} as const;

function isoOrEmpty(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function splitSkills(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseDateCellOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build the 14-cell row array from a JobPipelineRow. When `existing` is given
 * (i.e. an upsert hitting an existing row) the Status and Notes cells are taken
 * from the existing row and never overwritten — those belong to the user.
 */
function jobPipelineRowToCells(row: JobPipelineRow, existing?: unknown[]): unknown[] {
  // On insert (no `existing`): Status starts at 'new' and Notes at '' — both
  // belong to the user from then on and are never overwritten by an upsert.
  const status = existing ? (existing[JP_COL.status - 1] || 'new') : 'new';
  const notes = existing ? (existing[JP_COL.notes - 1] ?? '') : '';
  return [
    row.jobId,
    isoOrEmpty(row.discoveredAt),
    isoOrEmpty(row.postedAt),
    row.source,
    row.company ?? '',
    row.title ?? '',
    row.location ?? '',
    row.url,
    round3(row.finalScore),
    (row.matchedSkills ?? []).join(', '),
    (row.missingSkills ?? []).join(', '),
    status,
    row.tailoredDocUrl ?? '',
    notes,
  ];
}

/**
 * Open the spreadsheet and return the "Job Pipeline" sheet, creating it (with
 * a bold + frozen header row) if absent and (re)writing the header row if it's
 * missing or doesn't match the expected layout. Data rows are never touched.
 */
function ensureJobPipelineSheetObj(sheetId: string): {
  ss: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  sheet: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  sheetUrl: string;
} {
  const SpreadsheetApp = getSpreadsheetApp();
  const ss = SpreadsheetApp.openById(sheetId);

  let sheet = ss.getSheetByName(JOB_PIPELINE_SHEET_NAME);
  let created = false;
  if (!sheet) {
    sheet = ss.insertSheet(JOB_PIPELINE_SHEET_NAME);
    created = true;
  }

  const lastColumn: number = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
  let headerOk = false;
  if (!created && lastColumn >= JOB_PIPELINE_HEADER.length) {
    const headerRange = sheet.getRange(1, 1, 1, JOB_PIPELINE_HEADER.length);
    const current = headerRange.getValues()[0] ?? [];
    headerOk = JOB_PIPELINE_HEADER.every((h, i) => String(current[i] ?? '') === h);
  }

  if (created || !headerOk) {
    if (!created) {
      log('warn', 'Job Pipeline header missing or stale — rewriting it', { sheetId });
    }
    const headerRange = sheet.getRange(1, 1, 1, JOB_PIPELINE_HEADER.length);
    headerRange.setValues([JOB_PIPELINE_HEADER.slice()]);
    if (typeof headerRange.setFontWeight === 'function') headerRange.setFontWeight('bold');
    if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
  }

  const gid: number = typeof sheet.getSheetId === 'function' ? sheet.getSheetId() : 0;
  const ssUrl: string = typeof ss.getUrl === 'function' ? ss.getUrl() : '';
  const sheetUrl = `${ssUrl}#gid=${gid}`;
  return { ss, sheet, sheetUrl };
}

/**
 * Read every data row (everything below the header) as raw cell arrays, padded
 * to 14 columns. Returns an empty array when only the header (or nothing) is
 * present.
 */
function readJobPipelineDataRows(sheet: any): unknown[][] {
  const lastRow: number = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;
  if (lastRow < 2) return [];
  const range = sheet.getRange(2, 1, lastRow - 1, JOB_PIPELINE_HEADER.length);
  const values: unknown[][] = range.getValues() ?? [];
  return values.map((r) => {
    const out = r.slice(0, JOB_PIPELINE_HEADER.length);
    while (out.length < JOB_PIPELINE_HEADER.length) out.push('');
    return out;
  });
}

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
    } catch (err) {
      // M8 (silent-failure-audit): the blob fallback "will likely be empty/
      // garbage" — for a rule file that means the system prompt silently loses
      // load-bearing rules. We can't make this fatal here without a public-
      // surface change, but we make it visible so a degraded resume is
      // diagnosable from the execution log.
      log('warn', 'Google Doc text extraction failed — falling back to raw blob (content may be empty/garbage)', {
        fileName: typeof file.getName === 'function' ? file.getName() : undefined,
        fileId: typeof file.getId === 'function' ? file.getId() : undefined,
        error: err instanceof Error ? err.message : String(err),
      });
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
  } catch (err) {
    // M9 (silent-failure-audit): a corrupted cache entry would otherwise force
    // a full Drive re-read on every request, silently. Log it and evict the
    // bad entry so the next write replaces it.
    log('warn', 'cache entry was not valid JSON — evicting', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      const c = getCache() as { remove?: (k: string) => void };
      if (typeof c.remove === 'function') c.remove(key);
    } catch (removeErr) {
      log('warn', 'failed to evict corrupted cache entry', {
        key,
        error: removeErr instanceof Error ? removeErr.message : String(removeErr),
      });
    }
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

/**
 * Move a freshly-created Google Doc (which DocumentApp.create() places at the
 * user's My Drive root) into `targetFolder`. The DriveApp folder API exposes
 * `removeFile`/`addFile`; some test stubs omit them, so we keep the `typeof`
 * guard — but unlike the original code we LOG a warning when a move step can't
 * run, so an orphaned Doc at My Drive root is diagnosable (H14).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function moveDocIntoFolder(DriveApp: any, docId: string, targetFolder: any, context: string): void {
  let docFile: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    docFile = DriveApp.getFileById(docId);
  } catch (err) {
    log('warn', 'moveDocIntoFolder: could not look up created Doc — leaving at My Drive root', {
      context,
      docId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const parents = docFile.getParents();
  let removedFromAny = false;
  let removeUnavailable = false;
  while (parents.hasNext()) {
    const oldParent = parents.next();
    if (typeof oldParent.removeFile === 'function') {
      oldParent.removeFile(docFile);
      removedFromAny = true;
    } else {
      removeUnavailable = true;
    }
  }

  if (typeof targetFolder.addFile === 'function') {
    targetFolder.addFile(docFile);
  } else {
    log('warn', 'moveDocIntoFolder: target folder has no addFile — Doc not moved into job folder', {
      context,
      docId,
    });
    return;
  }

  if (removeUnavailable && !removedFromAny) {
    log('warn', 'moveDocIntoFolder: could not detach Doc from My Drive root (no removeFile) — Doc now lives in two parents', {
      context,
      docId,
    });
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

    // Move the Google Doc from My Drive root into the job folder.
    // H14 (silent-failure-audit): both removeFile/addFile were guarded with
    // `typeof === 'function'` and NO else branch — on a runtime where the API
    // shape differs the Doc would be silently left at My Drive root. We keep
    // the guard (so unit-test stubs that omit these still work) but log a warn
    // when the move can't be performed so the orphaned Doc is diagnosable.
    moveDocIntoFolder(DriveApp, docId, jobFolder, 'writeJobOutput');
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
          // H17 (silent-failure-audit): per-file failures already flow into
          // errors[] (correct shape) but the extension doesn't always surface
          // that array — log so a half-failed seed is visible server-side too.
          log('warn', 'seedDefaults: rule file fetch returned non-200', {
            filename,
            statusCode,
            url,
          });
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
        const reason = err instanceof Error ? err.message : String(err);
        log('warn', 'seedDefaults: failed to seed a rule file', { filename, error: reason });
        errors.push({ filename, reason });
      }
    }

    if (errors.length > 0) {
      log('warn', 'seedDefaults completed with errors', {
        seededCount: seeded.length,
        errorCount: errors.length,
      });
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
  // createFileInFolder
  // -------------------------------------------------------------------------
  createFileInFolder(
    folderId: string,
    fileName: string,
    content: string,
  ): { fileId: string; fileUrl: string } {
    const DriveApp = getDriveApp();
    const folder = DriveApp.getFolderById(folderId); // throws if invalid
    const file = folder.createFile(fileName, content, MD_MIME_TYPE);
    return {
      fileId: file.getId(),
      fileUrl: file.getUrl(),
    };
  },

  // -------------------------------------------------------------------------
  // createDriveFile
  //
  // Used by the onboarding wizard to scaffold `jobhelp-config.json`. When
  // parentFolderId is supplied, the file is created inside the referenced
  // folder; when omitted, it lands at the user's Drive root via
  // DriveApp.createFile(name, content, mimeType).
  // -------------------------------------------------------------------------
  createDriveFile(
    fileName: string,
    content: string,
    mimeType: string,
    parentFolderId?: string,
  ): { fileId: string; fileUrl: string } {
    const DriveApp = getDriveApp();
    let file: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (parentFolderId) {
      const folder = DriveApp.getFolderById(parentFolderId); // throws if invalid
      file = folder.createFile(fileName, content, mimeType);
    } else {
      // Drive root — DriveApp.createFile(name, content, mimeType)
      file = DriveApp.createFile(fileName, content, mimeType);
    }
    return {
      fileId: file.getId(),
      fileUrl: file.getUrl(),
    };
  },

  // -------------------------------------------------------------------------
  // createGoogleDoc
  // -------------------------------------------------------------------------
  createGoogleDoc(
    folderId: string,
    title: string,
    markdownContent: string,
  ): { docId: string; docUrl: string } {
    const DriveApp = getDriveApp();
    const DocumentApp = getDocumentApp();

    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    renderMarkdownToBody(body, DocumentApp, markdownContent);

    if (typeof doc.saveAndClose === 'function') {
      doc.saveAndClose();
    }

    const docId: string = doc.getId();
    const docUrl: string = doc.getUrl();

    // Move the Google Doc from My Drive root into the target folder.
    // See H14 note in writeJobOutput.
    const folder = DriveApp.getFolderById(folderId);
    moveDocIntoFolder(DriveApp, docId, folder, 'createGoogleDoc');

    return { docId, docUrl };
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
      // ---- v2 feature columns ----
      // Left blank on initial append. v2 handlers back-fill them via
      // updateSheetRow once they have data. We use '' (not undefined) so
      // the sheet displays a blank cell rather than the literal string
      // "undefined".
      row.critiqueScore ?? '',
      row.coverLetterUrl ?? '',
      row.verifyHookUnverifiedCount ?? '',
      row.multiVersionLabel ?? '',
    ];

    sheet.appendRow(dataRow);

    const rowIndex: number = sheet.getLastRow();
    const gid: number = sheet.getSheetId();
    const ssUrl: string = ss.getUrl();

    // H16 (silent-failure-audit): we trust getLastRow() to point at the row we
    // just appended (documented behaviour). If it ever comes back implausible
    // (≤ header row) the returned rowUrl is wrong and downstream v2 column
    // updates would patch the wrong row — surface that rather than swallow it.
    if (!Number.isFinite(rowIndex) || rowIndex < 2) {
      log('warn', 'appendSheetRow: getLastRow() returned an implausible index after append — rowUrl may be wrong', {
        rowIndex,
        company: row.company,
        role: row.role,
      });
    }

    // T18: rowUrl with #gid+row anchor
    const rowUrl = `${ssUrl}#gid=${gid}&range=A${rowIndex}`;

    return { rowIndex, rowUrl };
  },

  // -------------------------------------------------------------------------
  // updateSheetRow
  //
  // Update specific cells in an existing tracking-sheet row, located by the
  // rowUrl returned from appendSheetRow. Only columns whose key appears in
  // `fields` are written; every other cell is untouched.
  //
  // Used by v2 handlers to back-fill their columns (critiqueScore,
  // coverLetterUrl, verifyHookUnverifiedCount, multiVersionLabel) without
  // re-appending a row. handleGenerate does not call this — it leaves the
  // v2 columns blank on initial append, and the v2 handlers patch them later.
  // -------------------------------------------------------------------------
  updateSheetRow(
    sheetId: string,
    rowUrl: string,
    fields: Partial<SheetRow>,
  ): void {
    // 1. Parse rowIndex out of the rowUrl. We accept the same anchor shape
    //    that appendSheetRow produces: "...#gid=<gid>&range=A<row>".
    //    If parsing fails (caller passed a garbage URL) we silently no-op —
    //    v2 sheet updates are non-fatal, and the v2 handler is responsible
    //    for logging if it cares.
    // H15 (silent-failure-audit): these early returns used to be completely
    // silent — a future code path with a different anchor shape would leave the
    // v2 columns permanently empty with no trace. We still no-op (v2 sheet
    // writes are non-fatal by design) but we log a warn so it's diagnosable.
    const rowMatch = rowUrl.match(/[#&]range=[A-Z]+(\d+)/);
    if (!rowMatch) {
      log('warn', 'updateSheetRow: rowUrl has no parseable range anchor — skipping', {
        rowUrl,
        fields: Object.keys(fields),
      });
      return;
    }
    const rowIndex = Number(rowMatch[1]);
    if (!Number.isFinite(rowIndex) || rowIndex < 1) {
      log('warn', 'updateSheetRow: parsed row index is invalid — skipping', {
        rowUrl,
        rowIndex,
        fields: Object.keys(fields),
      });
      return;
    }

    const SpreadsheetApp = getSpreadsheetApp();
    const ss = SpreadsheetApp.openById(sheetId);

    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      log('warn', 'updateSheetRow: tracking sheet does not exist — skipping', {
        sheetId,
        fields: Object.keys(fields),
      });
      return; // sheet was never created — nothing to update
    }

    // 2. Write each provided field into its column. We use getRange(row,col)
    //    .setValue() so the rest of the row is preserved (vs. rewriting the
    //    whole row). Unknown keys (e.g. fields the COLUMN_INDEX doesn't know
    //    about) are silently ignored.
    for (const key of Object.keys(fields) as (keyof SheetRow)[]) {
      const col = COLUMN_INDEX[key];
      if (!col) {
        log('debug', 'updateSheetRow: ignoring field with no known column', { key: String(key) });
        continue;
      }
      const raw = fields[key];
      // Coerce null/undefined → '' so blank cells stay blank.
      const value: unknown = raw === null || raw === undefined ? '' : raw;
      const range = sheet.getRange(rowIndex, col);
      range.setValue(value);
    }
  },

  // -------------------------------------------------------------------------
  // ensureJobPipelineSheet
  // -------------------------------------------------------------------------
  ensureJobPipelineSheet(sheetId: string): { sheetUrl: string } {
    log('info', 'ensureJobPipelineSheet: start', { sheetId });
    const { sheetUrl } = ensureJobPipelineSheetObj(sheetId);
    log('info', 'ensureJobPipelineSheet: done', { sheetId, sheetUrl });
    return { sheetUrl };
  },

  // -------------------------------------------------------------------------
  // upsertJobPipelineRows
  //
  // Keyed by jobId: rows already present are updated in place but their Status
  // and Notes cells are preserved (the user owns those — only the initial
  // insert sets Status='new' and Notes=''). Writes are batched: existing rows
  // are collected into per-row ranges, new rows appended in a single trailing
  // setValues call.
  // -------------------------------------------------------------------------
  upsertJobPipelineRows(
    sheetId: string,
    rows: JobPipelineRow[],
  ): { inserted: number; updated: number; sheetUrl: string } {
    log('info', 'upsertJobPipelineRows: start', { sheetId, count: rows.length });
    const { sheet, sheetUrl } = ensureJobPipelineSheetObj(sheetId);

    const existingRows = readJobPipelineDataRows(sheet);
    const indexByJobId = new Map<string, number>(); // jobId -> 0-based data-row index
    existingRows.forEach((r, i) => {
      const id = String(r[JP_COL.jobId - 1] ?? '');
      if (id && !indexByJobId.has(id)) indexByJobId.set(id, i);
    });

    let inserted = 0;
    let updated = 0;
    const updates: { rowIndex: number; cells: unknown[] }[] = [];
    const appends: unknown[][] = [];

    for (const row of rows) {
      const jobId = String(row.jobId ?? '');
      if (jobId && indexByJobId.has(jobId)) {
        const dataIdx = indexByJobId.get(jobId)!;
        const cells = jobPipelineRowToCells(row, existingRows[dataIdx]);
        updates.push({ rowIndex: dataIdx + 2, cells }); // +2: 1 for header, 1 for 1-based
        updated++;
      } else {
        appends.push(jobPipelineRowToCells(row));
        inserted++;
      }
    }

    for (const u of updates) {
      sheet.getRange(u.rowIndex, 1, 1, JOB_PIPELINE_HEADER.length).setValues([u.cells]);
    }

    if (appends.length > 0) {
      const lastRow: number = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 1;
      const startRow = Math.max(lastRow, 1) + 1;
      sheet
        .getRange(startRow, 1, appends.length, JOB_PIPELINE_HEADER.length)
        .setValues(appends);
    }

    log('info', 'upsertJobPipelineRows: done', { sheetId, inserted, updated });
    return { inserted, updated, sheetUrl };
  },

  // -------------------------------------------------------------------------
  // updateJobPipelineStatus
  // -------------------------------------------------------------------------
  updateJobPipelineStatus(
    sheetId: string,
    jobId: string,
    status: JobPipelineStatus,
    tailoredDocUrl?: string,
  ): { updatedAt: number } {
    log('info', 'updateJobPipelineStatus: start', { sheetId, jobId, status });
    const { sheet } = ensureJobPipelineSheetObj(sheetId);
    const existingRows = readJobPipelineDataRows(sheet);

    let dataIdx = -1;
    for (let i = 0; i < existingRows.length; i++) {
      if (String(existingRows[i][JP_COL.jobId - 1] ?? '') === String(jobId)) {
        dataIdx = i;
        break;
      }
    }
    if (dataIdx === -1) {
      throw new Error(`No Job Pipeline row with jobId ${jobId}`);
    }

    const rowIndex = dataIdx + 2;
    sheet.getRange(rowIndex, JP_COL.status).setValue(status);
    if (tailoredDocUrl !== undefined) {
      sheet.getRange(rowIndex, JP_COL.tailoredDoc).setValue(tailoredDocUrl);
    }

    const updatedAt = Date.now();
    log('info', 'updateJobPipelineStatus: done', { sheetId, jobId, status, updatedAt });
    return { updatedAt };
  },

  // -------------------------------------------------------------------------
  // readJobPipelineRows
  // -------------------------------------------------------------------------
  readJobPipelineRows(sheetId: string): JobPipelineRow[] {
    log('info', 'readJobPipelineRows: start', { sheetId });
    const { sheet } = ensureJobPipelineSheetObj(sheetId);
    const dataRows = readJobPipelineDataRows(sheet);

    const out: JobPipelineRow[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const jobId = String(r[JP_COL.jobId - 1] ?? '').trim();
      if (!jobId) {
        log('warn', 'readJobPipelineRows: skipping row with empty Job ID', { sheetId, rowIndex: i + 2 });
        continue;
      }
      try {
        const scoreRaw = r[JP_COL.score - 1];
        const finalScore = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw);
        const row: JobPipelineRow = {
          jobId,
          discoveredAt: parseDateCellOrNull(r[JP_COL.discovered - 1]) ?? 0,
          postedAt: parseDateCellOrNull(r[JP_COL.posted - 1]),
          source: String(r[JP_COL.source - 1] ?? 'manual') as JobSource,
          company: String(r[JP_COL.company - 1] ?? ''),
          title: String(r[JP_COL.title - 1] ?? ''),
          location: r[JP_COL.location - 1] ? String(r[JP_COL.location - 1]) : null,
          url: String(r[JP_COL.url - 1] ?? ''),
          finalScore: Number.isFinite(finalScore) ? finalScore : 0,
          matchedSkills: splitSkills(r[JP_COL.matchedSkills - 1]),
          missingSkills: splitSkills(r[JP_COL.missingSkills - 1]),
          status: String(r[JP_COL.status - 1] ?? 'new') as JobPipelineStatus,
          tailoredDocUrl: r[JP_COL.tailoredDoc - 1] ? String(r[JP_COL.tailoredDoc - 1]) : null,
          notes: String(r[JP_COL.notes - 1] ?? ''),
        };
        if (parseDateCellOrNull(r[JP_COL.discovered - 1]) === null && r[JP_COL.discovered - 1]) {
          log('warn', 'readJobPipelineRows: unparseable Discovered date — treated as 0', {
            sheetId,
            rowIndex: i + 2,
            value: String(r[JP_COL.discovered - 1]),
          });
        }
        out.push(row);
      } catch (err) {
        log('warn', 'readJobPipelineRows: skipping malformed row', {
          sheetId,
          rowIndex: i + 2,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log('info', 'readJobPipelineRows: done', { sheetId, count: out.length });
    return out;
  },
};
