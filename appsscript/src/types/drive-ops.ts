/**
 * Drive operations interface used internally by Code.ts and tested in isolation.
 * All DriveApp/SpreadsheetApp/UrlFetchApp calls go through these functions.
 */

export interface FileEntry {
  name: string;
  fileId: string;
  contents: string;
  /** Approximate token count via chars/4 estimate */
  tokens: number;
  lastModifiedAt: number;
  /** True if frontmatter says load_bearing: true (rule files only) */
  loadBearing?: boolean;
}

export interface ConcatenatedSourceMaterials {
  /** Full concatenated text in alphabetical filename order, separated by === filename === headers */
  text: string;
  /** Per-file metadata for diagnostics */
  files: FileEntry[];
  totalTokens: number;
}

export interface DriveOps {
  /** Read all .md files in source-materials folder, alphabetical order */
  readSourceFiles(folderId: string): ConcatenatedSourceMaterials;

  /** Read all .md files in rules folder. If empty, throw — caller decides whether to seed. */
  readRuleFiles(folderId: string): FileEntry[];

  /** Create a new Google Doc with the given markdown content. Returns the Doc URL. */
  writeOutput(
    folderId: string,
    fileName: string,
    markdownContent: string,
  ): { docUrl: string; docId: string };

  /**
   * Create a per-job subfolder under the output folder, write the tailored
   * resume as both a markdown file and a Google Doc inside it, and return
   * the URLs of all three.
   *
   * @param parentFolderId  The user's configured output folder
   * @param jobFolderName   Human-readable subfolder name, e.g. "Acme - Senior Engineer - 2026-05-09"
   * @param markdownContent The tailored resume markdown
   */
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
  };

  /** Read a single file by id. */
  readFile(fileId: string): FileEntry;

  /** Overwrite a file's contents. Returns updated timestamp. */
  writeFile(fileId: string, newContents: string): { updatedAt: number };

  /** Fetch each filename from rawBaseUrl + "/" + filename and write to the rules folder */
  seedDefaults(
    folderId: string,
    rawBaseUrl: string,
    filenames: string[],
  ): { seeded: string[]; errors: { filename: string; reason: string }[] };

  /** Append a row to the tracking sheet. Creates the sheet if it doesn't exist. */
  appendSheetRow(
    sheetId: string,
    row: SheetRow,
  ): { rowIndex: number; rowUrl: string };

  /**
   * Update specific cells in an existing tracking-sheet row, located by the
   * rowUrl returned from {@link appendSheetRow}. Only the columns present in
   * `fields` are written; all other cells are left untouched.
   *
   * The rowUrl is expected to contain a `#gid=<n>&range=A<row>` anchor; if it
   * cannot be parsed, the call is a no-op. Used by v2 handlers (critique,
   * cover letter, verify hooks, multi-version) to back-fill their columns
   * after the row has already been appended by `handleGenerate`.
   */
  updateSheetRow(
    sheetId: string,
    rowUrl: string,
    fields: Partial<SheetRow>,
  ): void;

  /**
   * Replace the body of an existing Google Doc with new markdown content.
   * Uses the same simple markdown→Doc renderer as writeOutput.
   */
  replaceDocContents(docId: string, markdownContent: string): void;

  /**
   * Export a Google Doc as DOCX or PDF and save the resulting file inside
   * the given folder. Uses the Google Docs export endpoint via UrlFetchApp.
   */
  exportDocAs(
    docId: string,
    jobFolderId: string,
    format: "docx" | "pdf",
    fileName: string,
  ): { fileId: string; url: string; fileName: string };

  /**
   * Read a Drive file's binary contents and return a base64 string plus
   * metadata. Used by the templated-DOCX flow to ship the user's template
   * to the browser-side filler.
   */
  downloadFileAsBase64(
    fileId: string,
  ): { base64: string; fileName: string; mimeType: string };

  /**
   * Decode the given base64 bytes and save them as a file inside the given
   * folder under the requested filename. The MIME type is fixed to DOCX.
   * Returns the file id and direct URL.
   */
  uploadDocxFromBase64(
    folderId: string,
    fileName: string,
    base64: string,
  ): { fileId: string; url: string; fileName: string };

  /**
   * Write a plain-text/markdown file into an existing folder by ID.
   * Returns the new file's ID and direct URL.
   * Throws if the folderId is invalid.
   */
  createFileInFolder(
    folderId: string,
    fileName: string,
    content: string,
  ): { fileId: string; fileUrl: string };

  /**
   * Create a brand-new file in the user's Drive. If `parentFolderId` is
   * provided the file is created inside that folder; otherwise it is created
   * at the Drive root via DriveApp.createFile.
   *
   * Unlike {@link createFileInFolder}, this method accepts an explicit
   * `mimeType` (and defaults to "application/json"), so it can be used for
   * the onboarding scaffold of `jobhelp-config.json` and other small text
   * payloads where the MIME type matters.
   *
   * Throws if `parentFolderId` is provided but invalid.
   */
  createDriveFile(
    fileName: string,
    content: string,
    mimeType: string,
    parentFolderId?: string,
  ): { fileId: string; fileUrl: string };

  /**
   * Create a Google Doc with the given title and markdown content inside an
   * existing folder by ID. Returns the Doc URL.
   * Throws if the folderId is invalid.
   */
  createGoogleDoc(
    folderId: string,
    title: string,
    markdownContent: string,
  ): { docId: string; docUrl: string };
}

export interface SheetRow {
  date: string; // ISO 8601
  company: string | null;
  role: string | null;
  /** Job posting location (city / Remote / etc.) */
  location?: string | null;
  /** Salary range as a display string, e.g. "$180k-$220k" */
  salary?: string | null;
  /** Where the job was found, derived from URL hostname (LinkedIn / Indeed / etc.) */
  source?: string | null;
  url: string;
  /** URL of the per-job folder (set when writeJobOutput was used) */
  folderUrl?: string | null;
  docUrl: string;
  /** URL of the final DOCX (filled by `finalize` action; blank initially) */
  finalDocxUrl?: string | null;
  /** URL of the final PDF (filled by `finalize` action; blank initially) */
  finalPdfUrl?: string | null;
  modelUsed: string;
  costUsd: number;
  keywordMatchRate: number;
  notes?: string;
  // ---- v2 feature columns (optional; left blank by handleGenerate, populated
  // later by v2 handlers via updateSheetRow) ----
  /** Critique total weighted score, 0-10 (filled by `critique` handler) */
  critiqueScore?: number;
  /** URL of the cover letter doc (filled by `cover_letter` handler) */
  coverLetterUrl?: string;
  /** Number of unverified entities (filled by `verify_cl_hooks` handler) */
  verifyHookUnverifiedCount?: number;
  /** Label of the chosen multi-version variant (filled by `multi_version` handler) */
  multiVersionLabel?: string;
}
