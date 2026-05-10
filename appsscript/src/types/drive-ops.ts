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
}
