/**
 * Mirror of extension/src/types/api-contract.ts — kept in sync manually.
 * Apps Script's V8 runtime can read TS files via clasp's tsc compilation.
 *
 * SOURCE OF TRUTH: extension/src/types/api-contract.ts. When that file changes,
 * paste the same content here verbatim.
 */

import type { JobInsights } from "./job-insights.js";

export type ApiAction =
  | "generate"
  | "finalize"
  | "list_files"
  | "write_file"
  | "seed_defaults"
  | "download_template"
  | "upload_filled_docx"
  | "ping";

export interface ToggleSetting {
  enabled: boolean;
  model: string;
}

export interface ToggleConfig {
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

export interface GenerateRequest {
  action: "generate";
  jd: string;
  company: string | null;
  role: string | null;
  url: string;
  jobInsights: JobInsights | null;
  toggles: ToggleConfig;
  sourceFolderId: string;
  rulesFolderId: string;
  outputFolderId: string;
  sheetId: string;
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
  matched: string[];
  missing: string[];
  rate: number;
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalUsd: number;
}

export interface GenerateResult {
  resumeMd: string;
  /** URL of the Google Doc rendering inside the per-job folder */
  docUrl: string;
  /** URL of the per-job folder containing both the .md and the Doc */
  jobFolderUrl: string;
  /** URL of the raw tailored_resume.md file inside the job folder */
  mdFileUrl: string;
  sheetRowUrl: string;
  missingSkills: string[];
  keywordCoverage: KeywordCoverage;
  reframings: ReframingApplied[];
  cost: CostBreakdown;
  modelUsed: string;
}

export type GenerateResponse = ApiResult<GenerateResult>;

export type FinalizeFormat = "docx" | "pdf";

export interface FinalizeRequest {
  action: "finalize";
  docId: string;
  jobFolderId: string;
  finalMarkdown: string;
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

export type FolderType = "source" | "rules";

export interface ListFilesRequest {
  action: "list_files";
  folderId: string;
  folderType: FolderType;
}

export interface FileSummary {
  name: string;
  fileId: string;
  viewUrl: string;
  tokens: number;
  loadBearing?: boolean;
  lastModifiedAt: number;
}

export interface ListFilesResult {
  files: FileSummary[];
  totalTokens: number;
}

export type ListFilesResponse = ApiResult<ListFilesResult>;

export interface WriteFileRequest {
  action: "write_file";
  fileId: string;
  newContents: string;
}

export type WriteFileResponse = ApiResult<{ updatedAt: number }>;

export interface SeedDefaultsRequest {
  action: "seed_defaults";
  rulesFolderId: string;
  rawBaseUrl: string;
  filenames: string[];
}

export interface SeedDefaultsResult {
  seeded: string[];
  errors: { filename: string; reason: string }[];
}

export type SeedDefaultsResponse = ApiResult<SeedDefaultsResult>;

export interface DownloadTemplateRequest {
  action: "download_template";
  fileId: string;
}

export interface DownloadTemplateResult {
  base64: string;
  fileName: string;
  mimeType: string;
}

export type DownloadTemplateResponse = ApiResult<DownloadTemplateResult>;

export interface UploadFilledDocxRequest {
  action: "upload_filled_docx";
  folderId: string;
  fileName: string;
  base64: string;
}

export interface UploadFilledDocxResult {
  fileId: string;
  url: string;
  fileName: string;
}

export type UploadFilledDocxResponse = ApiResult<UploadFilledDocxResult>;

export interface PingRequest {
  action: "ping";
}

export type PingResponse = ApiResult<{ version: string; serverTime: number }>;

export type ApiRequest =
  | GenerateRequest
  | FinalizeRequest
  | ListFilesRequest
  | WriteFileRequest
  | SeedDefaultsRequest
  | DownloadTemplateRequest
  | UploadFilledDocxRequest
  | PingRequest;
