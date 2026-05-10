/**
 * HTTP contract between the Chrome extension and the Apps Script backend.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. The Apps Script side keeps a mirror at
 * appsscript/src/types/api-contract.ts — when this changes, sync both.
 */

import type { JobInsights } from "./job-insights.js";

// ─────────────────────────────────────────────────────────────────────────────
// Common
// ─────────────────────────────────────────────────────────────────────────────

export type ApiAction =
  | "generate"
  | "finalize"
  | "list_files"
  | "write_file"
  | "seed_defaults"
  | "ping";

export interface ToggleSetting {
  enabled: boolean;
  /** Anthropic model id, e.g. "claude-haiku-4-5-20251001" */
  model: string;
}

export interface ToggleConfig {
  // v1: only "generate" is implemented; others ship in v2-v5 but the contract is reserved.
  research?: ToggleSetting;
  critique?: ToggleSetting;
  autoRevise?: ToggleSetting;
  multiVersion?: ToggleSetting & { count: number };
  coverLetter?: ToggleSetting;
  verifyHooks?: ToggleSetting;
}

export interface ApiError {
  type: "auth" | "rate_limit" | "server" | "validation" | "drive" | "config" | "other";
  message: string;
  retryable: boolean;
}

export interface ApiErrorResponse {
  ok: false;
  error: ApiError;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Action: generate
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  action: "generate";
  jd: string;
  company: string | null;
  role: string | null;
  url: string;
  jobInsights: JobInsights | null;
  toggles: ToggleConfig;
  /** Drive folder id for source materials (read by Apps Script) */
  sourceFolderId: string;
  /** Drive folder id for rule files (read by Apps Script) */
  rulesFolderId: string;
  /** Drive folder id where outputs are written */
  outputFolderId: string;
  /** Spreadsheet id for the tracking sheet */
  sheetId: string;
  /** Default Anthropic model for the generate step */
  model: string;
}

export interface ReframingApplied {
  bulletId: string;
  original: string;
  reframed: string;
  reason: string;
  truthfulnessJustification: string;
}

export interface KeywordCoverage {
  /** Keywords from the JD that appeared in the tailored resume */
  matched: string[];
  /** Keywords from the JD that did NOT appear (gaps) */
  missing: string[];
  /** Match rate as 0..1 */
  rate: number;
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** USD cost rounded to 4 decimals */
  totalUsd: number;
}

export interface GenerateResult {
  /** Generated resume in Markdown */
  resumeMd: string;
  /** Google Doc URL for the saved output (inside the per-job folder) */
  docUrl: string;
  /** URL of the per-job subfolder created under the user's output folder */
  jobFolderUrl: string;
  /** URL of the raw tailored_resume.md file in the job folder */
  mdFileUrl: string;
  /** Sheet row URL (with cell anchor if possible) */
  sheetRowUrl: string;
  /** Skills the JD wants but the user's source materials don't evidence */
  missingSkills: string[];
  keywordCoverage: KeywordCoverage;
  reframings: ReframingApplied[];
  cost: CostBreakdown;
  /** Anthropic model actually used */
  modelUsed: string;
}

export type GenerateResponse = ApiResult<GenerateResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Action: finalize
// Convert the (possibly user-edited) markdown to DOCX and/or PDF using Google
// Docs' native export. Updates the existing tailored_resume Doc with the
// final markdown, then writes the converted file(s) into the same job folder.
// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeFormat = "docx" | "pdf";

export interface FinalizeRequest {
  action: "finalize";
  /** ID of the existing tailored_resume Google Doc (returned by `generate`) */
  docId: string;
  /** ID of the per-job folder where converted files are saved */
  jobFolderId: string;
  /** The (possibly user-edited) markdown to render before exporting */
  finalMarkdown: string;
  /** Which formats to produce. Each format becomes one file in the job folder. */
  formats: FinalizeFormat[];
}

export interface FinalizedFile {
  format: FinalizeFormat;
  fileId: string;
  url: string;
  fileName: string;
}

export interface FinalizeResult {
  files: FinalizedFile[];
}

export type FinalizeResponse = ApiResult<FinalizeResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Action: list_files
// ─────────────────────────────────────────────────────────────────────────────

export type FolderType = "source" | "rules";

export interface ListFilesRequest {
  action: "list_files";
  folderId: string;
  folderType: FolderType;
}

export interface FileSummary {
  name: string;
  /** Drive file id */
  fileId: string;
  /** Direct Drive view URL */
  viewUrl: string;
  /** Approximate token count for this file */
  tokens: number;
  /** Whether the file is marked load_bearing in its frontmatter (rules only) */
  loadBearing?: boolean;
  lastModifiedAt: number;
}

export interface ListFilesResult {
  files: FileSummary[];
  totalTokens: number;
}

export type ListFilesResponse = ApiResult<ListFilesResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Action: write_file
// ─────────────────────────────────────────────────────────────────────────────

export interface WriteFileRequest {
  action: "write_file";
  fileId: string;
  newContents: string;
}

export type WriteFileResponse = ApiResult<{ updatedAt: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// Action: seed_defaults
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedDefaultsRequest {
  action: "seed_defaults";
  rulesFolderId: string;
  /** Base raw URL for fetching rule files; e.g. https://raw.githubusercontent.com/<user>/<repo>/main/prompts/shared */
  rawBaseUrl: string;
  /** List of expected filenames (e.g. ["01-priority-hierarchy.md", ...]) */
  filenames: string[];
}

export interface SeedDefaultsResult {
  seeded: string[];
  errors: { filename: string; reason: string }[];
}

export type SeedDefaultsResponse = ApiResult<SeedDefaultsResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Action: ping (health check)
// ─────────────────────────────────────────────────────────────────────────────

export interface PingRequest {
  action: "ping";
}

export type PingResponse = ApiResult<{ version: string; serverTime: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// Union types for routing
// ─────────────────────────────────────────────────────────────────────────────

export type ApiRequest =
  | GenerateRequest
  | FinalizeRequest
  | ListFilesRequest
  | WriteFileRequest
  | SeedDefaultsRequest
  | PingRequest;
