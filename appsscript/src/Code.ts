/**
 * Apps Script HTTP entry point.
 * Parses the POST body, validates the action, routes to the appropriate handler,
 * catches and normalises errors, and returns a JSON TextOutput.
 *
 * All Drive, Claude, and prompt dependencies are injected so this module is
 * fully unit-testable without touching GAS globals.
 */

import type {
  ApiAction,
  ApiErrorResponse,
  ApiResult,
  GenerateRequest,
  GenerateResult,
  FinalizeRequest,
  FinalizeResult,
  FinalizedFile,
  FinalizeFormat,
  ListFilesRequest,
  ListFilesResult,
  FileSummary,
  WriteFileRequest,
  SeedDefaultsRequest,
  SeedDefaultsResult,
  DownloadTemplateRequest,
  DownloadTemplateResult,
  UploadFilledDocxRequest,
  UploadFilledDocxResult,
  CreateDriveFileRequest,
  KeywordCoverage,
  ResearchCompanyRequest,
  BenchmarkRoleRequest,
  CritiqueRequest,
  AutoReviseRequest,
  CoverLetterRequest,
  VerifyClHooksRequest,
  MultiVersionRequest,
} from './types/api-contract.js';

import { handleCreateDriveFile, validateCreateDriveFile } from './handlers/createDriveFile.js';

// v2 handler imports
import { handleResearchCompany, validateResearchCompany } from './handlers/research.js';
import { handleBenchmarkRole, validateBenchmarkRole } from './handlers/benchmark.js';
import { handleCritique, validateCritique } from './handlers/critique.js';
import { handleAutoRevise, validateAutoRevise } from './handlers/autoRevise.js';
import { handleCoverLetter, validateCoverLetter } from './handlers/coverLetter.js';
import { handleVerifyClHooks, validateVerifyClHooks } from './handlers/verifyHooks.js';
import { handleMultiVersion, validateMultiVersion } from './handlers/multiVersion.js';
import type { DriveOps, FileEntry } from './types/drive-ops.js';
import type { ClaudeClient, SystemBlock } from './types/claude-api.js';
import { ClaudeApiError } from './types/claude-api.js';
import { calculateCost } from './cost.js';
import { buildUserMessage, buildJobInsightsSummary } from './message-builder.js';
import { log } from './lib/structuredLog.js';

// Production dependencies — esbuild inlines these. In tests, doPost(e, deps)
// receives mocked versions via the optional second arg.
import { driveOps as productionDriveOps } from './drive.js';
import { callClaude as productionCallClaude } from './claude.js';
import { composeSystemPrompt as productionComposeSystemPrompt } from './prompt.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Dependency bag
// ---------------------------------------------------------------------------

/** All external dependencies, injectable for testing. */
export interface Deps {
  drive: DriveOps;
  claude: ClaudeClient;
  prompt: { composeSystemPrompt(ruleFiles: FileEntry[]): SystemBlock };
}

// ---------------------------------------------------------------------------
// doPost entry point
// ---------------------------------------------------------------------------

/**
 * Main HTTP entry point called by Apps Script.
 * Accepts an optional `deps` argument for dependency injection in tests.
 */
export function doPost(
  e: GoogleAppsScript.Events.DoPost,
  deps?: Deps,
): GoogleAppsScript.Content.TextOutput {
  let body: unknown;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    log('warn', 'Rejected request: body is not valid JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonOutput(validationError('Request body is not valid JSON'));
  }

  const resolved = deps ?? resolveDeps();

  const action =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)['action']
      : undefined;
  log('info', 'doPost received request', { action: typeof action === 'string' ? action : null });

  try {
    const result = route(body, resolved);
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput(classifyError(err));
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const VALID_ACTIONS: ApiAction[] = [
  'generate',
  'finalize',
  'list_files',
  'write_file',
  'seed_defaults',
  'download_template',
  'upload_filled_docx',
  'create_drive_file',
  // v2 feature actions
  'research_company',
  'benchmark_role',
  'critique',
  'auto_revise',
  'cover_letter',
  'verify_cl_hooks',
  'multi_version',
  'ping',
];

function route(body: unknown, deps: Deps): ApiResult<unknown> {
  if (typeof body !== 'object' || body === null) {
    return validationError('Request body must be a JSON object');
  }

  const raw = body as Record<string, unknown>;
  const action = raw['action'];

  if (!action) {
    return validationError('Missing required field: action');
  }

  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ApiAction)) {
    return validationError(`Unknown action: "${String(action)}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }

  switch (action as ApiAction) {
    case 'ping':
      return handlePing();

    case 'generate': {
      const validateErr = validateGenerate(raw);
      if (validateErr) return validateErr;
      return handleGenerate(deps, raw as unknown as GenerateRequest);
    }

    case 'finalize': {
      const validateErr = validateFinalize(raw);
      if (validateErr) return validateErr;
      return handleFinalize(deps, raw as unknown as FinalizeRequest);
    }

    case 'list_files': {
      const validateErr = validateListFiles(raw);
      if (validateErr) return validateErr;
      return handleListFiles(deps, raw as unknown as ListFilesRequest);
    }

    case 'write_file': {
      const validateErr = validateWriteFile(raw);
      if (validateErr) return validateErr;
      return handleWriteFile(deps, raw as unknown as WriteFileRequest);
    }

    case 'seed_defaults': {
      const validateErr = validateSeedDefaults(raw);
      if (validateErr) return validateErr;
      return handleSeedDefaults(deps, raw as unknown as SeedDefaultsRequest);
    }

    case 'download_template': {
      const validateErr = validateDownloadTemplate(raw);
      if (validateErr) return validateErr;
      return handleDownloadTemplate(deps, raw as unknown as DownloadTemplateRequest);
    }

    case 'upload_filled_docx': {
      const validateErr = validateUploadFilledDocx(raw);
      if (validateErr) return validateErr;
      return handleUploadFilledDocx(deps, raw as unknown as UploadFilledDocxRequest);
    }

    case 'create_drive_file': {
      const validateErr = validateCreateDriveFile(raw);
      if (validateErr) return validateErr;
      return handleCreateDriveFile(deps, raw as unknown as CreateDriveFileRequest);
    }

    // ── v2 feature routes ──────────────────────────────────────────────────

    case 'research_company': {
      const validateErr = validateResearchCompany(raw);
      if (validateErr) return validateErr;
      return handleResearchCompany(deps, raw as unknown as ResearchCompanyRequest);
    }

    case 'benchmark_role': {
      const validateErr = validateBenchmarkRole(raw);
      if (validateErr) return validateErr;
      return handleBenchmarkRole(deps, raw as unknown as BenchmarkRoleRequest);
    }

    case 'critique': {
      const validateErr = validateCritique(raw);
      if (validateErr) return validateErr;
      return handleCritique(deps, raw as unknown as CritiqueRequest);
    }

    case 'auto_revise': {
      const validateErr = validateAutoRevise(raw);
      if (validateErr) return validateErr;
      return handleAutoRevise(deps, raw as unknown as AutoReviseRequest);
    }

    case 'cover_letter': {
      const validateErr = validateCoverLetter(raw);
      if (validateErr) return validateErr;
      return handleCoverLetter(deps, raw as unknown as CoverLetterRequest);
    }

    case 'verify_cl_hooks': {
      const validateErr = validateVerifyClHooks(raw);
      if (validateErr) return validateErr;
      return handleVerifyClHooks(deps, raw as unknown as VerifyClHooksRequest);
    }

    case 'multi_version': {
      const validateErr = validateMultiVersion(raw);
      if (validateErr) return validateErr;
      return handleMultiVersion(deps, raw as unknown as MultiVersionRequest);
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handlePing(): ApiResult<{ version: string; serverTime: number }> {
  return {
    ok: true,
    version: VERSION,
    serverTime: Date.now(),
  };
}

function handleGenerate(deps: Deps, req: GenerateRequest): ApiResult<GenerateResult> {
  const { drive, claude, prompt } = deps;

  // 1. Read source materials
  const sourceMaterials = drive.readSourceFiles(req.sourceFolderId);

  // 2. Read rule files (if empty, surface as drive error suggesting seed)
  let ruleFiles: FileEntry[];
  try {
    ruleFiles = drive.readRuleFiles(req.rulesFolderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('warn', 'generate: rules folder unreadable/empty', { error: msg });
    return driveError(
      `Rules folder appears empty. Seed defaults first. (${msg})`,
    );
  }

  // 3. Compose system prompt from rule files
  const systemPrompt = prompt.composeSystemPrompt(ruleFiles);

  // 4. Build user message
  const jobInsightsSummary = req.jobInsights
    ? buildJobInsightsSummary(req.jobInsights)
    : '';
  const userMessage = buildUserMessage({
    jd: req.jd,
    company: req.company,
    role: req.role,
    jobInsightsSummary,
    sourceMaterialsText: sourceMaterials.text,
    researchSummary: req.researchSummary,
    benchmarkPatterns: req.benchmarkPatterns,
  });

  // 5. Call Claude
  const claudeResponse = claude.call({
    model: req.model,
    maxTokens: 4096,
    // composeSystemPrompt already returns a SystemBlock with the cache_control set.
    // Don't double-wrap it.
    system: [systemPrompt],
    messages: [{ role: 'user', content: userMessage }],
  });

  // 6. Extract resume markdown from response (v1: response is pure markdown)
  const resumeMd = claudeResponse.text;

  // 7. Write output: per-job folder containing both .md and Google Doc
  const date = new Date().toISOString().slice(0, 10);
  const safe = (s: string | null | undefined): string =>
    (s ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || 'Unknown';
  const jobFolderName = `${safe(req.company)} - ${safe(req.role)} - ${date}`;
  const { jobFolderUrl, docUrl, mdFileUrl } = drive.writeJobOutput(
    req.outputFolderId,
    jobFolderName,
    resumeMd,
  );

  // 8. Compute keyword coverage
  const keywordCoverage = computeKeywordCoverage(req.jobInsights, resumeMd);

  // 9. Compute cost
  const cost = calculateCost(claudeResponse.usage, claudeResponse.model);

  // 10. Log to sheet
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const dateReadable = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Derive a friendly source from the URL hostname
  const sourceFromUrl = (url: string): string => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('linkedin.com')) return 'LinkedIn';
      if (host.includes('indeed.com')) return 'Indeed';
      if (host.includes('greenhouse.io')) return 'Greenhouse';
      if (host.includes('lever.co')) return 'Lever';
      if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) return 'Workday';
      if (host.includes('ashbyhq.com')) return 'Ashby';
      if (host.includes('wellfound.com')) return 'Wellfound';
      if (host.includes('builtin.com')) return 'Built In';
      if (host.includes('glassdoor.com')) return 'Glassdoor';
      return host.replace(/^www\./, '');
    } catch {
      return 'Direct';
    }
  };

  // Derive location + salary string from jobInsights (if present)
  const locationString = req.jobInsights?.location
    ? `${req.jobInsights.location}${req.jobInsights.remote ? ` (${req.jobInsights.remote})` : ''}`
    : '';
  const salaryString =
    req.jobInsights?.salaryMin != null
      ? `$${(req.jobInsights.salaryMin / 1000).toFixed(0)}k${
          req.jobInsights.salaryMax != null ? `-$${(req.jobInsights.salaryMax / 1000).toFixed(0)}k` : ''
        }`
      : '';

  log('info', 'generate complete', {
    company: req.company,
    role: req.role,
    modelUsed: claudeResponse.model,
    cost: cost.totalUsd,
    keywordMatchRate: keywordCoverage.rate,
  });

  const { rowUrl: sheetRowUrl } = drive.appendSheetRow(req.sheetId, {
    date: dateReadable,
    company: req.company,
    role: req.role,
    location: locationString,
    salary: salaryString,
    source: sourceFromUrl(req.url),
    url: req.url,
    folderUrl: jobFolderUrl,
    docUrl,
    finalDocxUrl: '',
    finalPdfUrl: '',
    modelUsed: claudeResponse.model,
    costUsd: cost.totalUsd,
    keywordMatchRate: keywordCoverage.rate,
  });

  return {
    ok: true,
    resumeMd,
    docUrl,
    jobFolderUrl,
    mdFileUrl,
    sheetRowUrl,
    missingSkills: keywordCoverage.missing,
    keywordCoverage,
    reframings: [],   // v1: no reframing analysis yet
    cost,
    modelUsed: claudeResponse.model,
  };
}

function handleListFiles(deps: Deps, req: ListFilesRequest): ApiResult<ListFilesResult> {
  const { drive } = deps;

  let entries: FileEntry[];
  if (req.folderType === 'rules') {
    entries = drive.readRuleFiles(req.folderId);
  } else {
    const materials = drive.readSourceFiles(req.folderId);
    entries = materials.files;
  }

  // Sort alphabetically by name
  entries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const files: FileSummary[] = entries.map(f => ({
    name: f.name,
    fileId: f.fileId,
    viewUrl: `https://drive.google.com/file/d/${f.fileId}/view`,
    tokens: f.tokens,
    loadBearing: f.loadBearing,
    lastModifiedAt: f.lastModifiedAt,
  }));

  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

  return { ok: true, files, totalTokens };
}

function handleWriteFile(deps: Deps, req: WriteFileRequest): ApiResult<{ updatedAt: number }> {
  const result = deps.drive.writeFile(req.fileId, req.newContents);
  return { ok: true, ...result };
}

function handleSeedDefaults(deps: Deps, req: SeedDefaultsRequest): ApiResult<SeedDefaultsResult> {
  const result = deps.drive.seedDefaults(
    req.rulesFolderId,
    req.rawBaseUrl,
    req.filenames,
  );
  return { ok: true, ...result };
}

function handleDownloadTemplate(
  deps: Deps,
  req: DownloadTemplateRequest,
): ApiResult<DownloadTemplateResult> {
  const result = deps.drive.downloadFileAsBase64(req.fileId);
  return { ok: true, ...result };
}

function handleUploadFilledDocx(
  deps: Deps,
  req: UploadFilledDocxRequest,
): ApiResult<UploadFilledDocxResult> {
  const result = deps.drive.uploadDocxFromBase64(req.folderId, req.fileName, req.base64);
  return { ok: true, ...result };
}

function handleFinalize(deps: Deps, req: FinalizeRequest): ApiResult<FinalizeResult> {
  const { drive } = deps;

  // 1. Update the existing Doc with the latest markdown
  drive.replaceDocContents(req.docId, req.finalMarkdown);

  // 2. For each requested format, export and save
  const files: FinalizedFile[] = [];
  for (const format of req.formats) {
    const fileName = format === 'pdf' ? 'final_resume.pdf' : 'final_resume.docx';
    const result = drive.exportDocAs(req.docId, req.jobFolderId, format, fileName);
    files.push({ format, ...result });
  }

  return { ok: true, files };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateGenerate(raw: Record<string, unknown>): ApiErrorResponse | null {
  const required = ['jd', 'url', 'sourceFolderId', 'rulesFolderId', 'outputFolderId', 'sheetId', 'model'];
  for (const field of required) {
    if (!raw[field] || typeof raw[field] !== 'string') {
      return validationError(`Missing or invalid required field: ${field}`);
    }
  }

  // H11 (silent-failure-audit): when the scraper fails to extract BOTH company
  // and role, the job folder + sheet row collapse to "Unknown - Unknown - <date>"
  // which then collides across unrelated jobs. Refuse rather than silently
  // coercing to "Unknown".
  const companyEmpty = typeof raw['company'] !== 'string' || (raw['company'] as string).trim().length === 0;
  const roleEmpty = typeof raw['role'] !== 'string' || (raw['role'] as string).trim().length === 0;
  if (companyEmpty && roleEmpty) {
    return validationError(
      'Both company and role are empty — fill in at least one before generating ' +
      '(otherwise the output folder name would be "Unknown - Unknown").',
    );
  }

  // H19 (silent-failure-audit): jobInsights is consumed unchecked downstream
  // (jobInsights.skillsRequired.length). Reject obviously-wrong shapes upfront.
  if (raw['jobInsights'] !== undefined && raw['jobInsights'] !== null) {
    if (!isPlausibleJobInsights(raw['jobInsights'])) {
      return validationError('jobInsights, when provided, must be an object with a skillsRequired array');
    }
  }
  return null;
}

/**
 * Minimal structural guard for the JobInsights shape. We only check the fields
 * handleGenerate actually dereferences (skillsRequired must be an array) — a
 * full schema validator lives in the extension; the backend just needs to not
 * crash mid-pipeline on garbage.
 */
function isPlausibleJobInsights(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o['skillsRequired'])) return false;
  return true;
}

function validateListFiles(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['folderId'] || typeof raw['folderId'] !== 'string') {
    return validationError('Missing required field: folderId');
  }
  if (raw['folderType'] !== 'source' && raw['folderType'] !== 'rules') {
    return validationError('folderType must be "source" or "rules"');
  }
  return null;
}

function validateWriteFile(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['fileId'] || typeof raw['fileId'] !== 'string') {
    return validationError('Missing required field: fileId');
  }
  if (typeof raw['newContents'] !== 'string') {
    return validationError('Missing required field: newContents');
  }
  return null;
}

function validateSeedDefaults(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['rulesFolderId'] || typeof raw['rulesFolderId'] !== 'string') {
    return validationError('Missing required field: rulesFolderId');
  }
  if (!raw['rawBaseUrl'] || typeof raw['rawBaseUrl'] !== 'string') {
    return validationError('Missing required field: rawBaseUrl');
  }
  if (!Array.isArray(raw['filenames'])) {
    return validationError('Missing required field: filenames (must be an array)');
  }
  return null;
}

function validateDownloadTemplate(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['fileId'] || typeof raw['fileId'] !== 'string') {
    return validationError('Missing required field: fileId');
  }
  return null;
}

function validateUploadFilledDocx(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['folderId'] || typeof raw['folderId'] !== 'string') {
    return validationError('Missing required field: folderId');
  }
  if (!raw['fileName'] || typeof raw['fileName'] !== 'string') {
    return validationError('Missing required field: fileName');
  }
  if (typeof raw['base64'] !== 'string' || raw['base64'].length === 0) {
    return validationError('Missing required field: base64');
  }
  return null;
}

const VALID_FINALIZE_FORMATS: FinalizeFormat[] = ['docx', 'pdf'];

function validateFinalize(raw: Record<string, unknown>): ApiErrorResponse | null {
  if (!raw['docId'] || typeof raw['docId'] !== 'string') {
    return validationError('Missing required field: docId');
  }
  if (!raw['jobFolderId'] || typeof raw['jobFolderId'] !== 'string') {
    return validationError('Missing required field: jobFolderId');
  }
  if (typeof raw['finalMarkdown'] !== 'string') {
    return validationError('Missing required field: finalMarkdown');
  }
  if (!Array.isArray(raw['formats']) || (raw['formats'] as unknown[]).length === 0) {
    return validationError('Missing or empty required field: formats (must be a non-empty array)');
  }
  const formats = raw['formats'] as unknown[];
  for (const fmt of formats) {
    if (!VALID_FINALIZE_FORMATS.includes(fmt as FinalizeFormat)) {
      return validationError(`Invalid format: "${String(fmt)}". Must be one of: ${VALID_FINALIZE_FORMATS.join(', ')}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

function validationError(message: string): ApiErrorResponse {
  return {
    ok: false,
    error: { type: 'validation', message, retryable: false },
  };
}

function driveError(message: string): ApiErrorResponse {
  return {
    ok: false,
    error: { type: 'drive', message, retryable: false },
  };
}

function classifyError(err: unknown): ApiErrorResponse {
  if (err instanceof ClaudeApiError) {
    return {
      ok: false,
      error: {
        type: err.errorType,
        message: err.message,
        retryable: err.retryable,
      },
    };
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Drive errors typically mention "folder not found", "file not found", etc.
    // NOTE (H8, silent-failure-audit): this english-substring classification is
    // brittle — a localised Drive error message slips through to type:"other".
    // The proper fix is a typed DriveError exception hierarchy in drive.ts (a
    // public-surface change, flagged separately). Until then we at least log the
    // raw error so the true cause is recoverable from the execution log.
    if (
      msg.includes('folder not found') ||
      msg.includes('file not found') ||
      msg.includes('no files') ||
      msg.includes('empty folder')
    ) {
      log('warn', 'Request failed with a Drive error (classified by message substring)', {
        error: err.message,
      });
      return driveError(err.message);
    }

    log('error', 'Request failed with an unclassified error', {
      error: err.message,
      name: err.name,
    });
    return {
      ok: false,
      error: { type: 'other', message: err.message, retryable: false },
    };
  }

  log('error', 'Request failed with a non-Error throwable', { error: String(err) });
  return {
    ok: false,
    error: { type: 'other', message: 'An unexpected error occurred', retryable: false },
  };
}

// ---------------------------------------------------------------------------
// Business logic helpers
// ---------------------------------------------------------------------------

import type { JobInsights } from './types/job-insights.js';

function computeKeywordCoverage(
  jobInsights: JobInsights | null,
  resumeMd: string,
): KeywordCoverage {
  if (!jobInsights || jobInsights.skillsRequired.length === 0) {
    return { matched: [], missing: [], rate: 1 };
  }

  const resumeLower = resumeMd.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of jobInsights.skillsRequired) {
    if (resumeLower.includes(skill.canonical.toLowerCase())) {
      matched.push(skill.canonical);
    } else {
      missing.push(skill.canonical);
    }
  }

  const rate = jobInsights.skillsRequired.length > 0
    ? Math.round((matched.length / jobInsights.skillsRequired.length) * 1000) / 1000
    : 1;

  return { matched, missing, rate };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function jsonOutput(data: unknown): GoogleAppsScript.Content.TextOutput {
  const content = JSON.stringify(data);
  // In Apps Script runtime, ContentService is a global. The web-app return
  // value MUST be a real ContentService.TextOutput — Apps Script rejects
  // plain objects with "returned value is not a supported return type".
  //
  // In Vitest, ContentService is undefined. We fall back to a stub that
  // exposes .getContent() / .content so tests can read the body either way.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ContentService = (globalThis as any).ContentService as
    | { createTextOutput: (s: string) => GoogleAppsScript.Content.TextOutput; MimeType?: { JSON?: unknown } }
    | undefined;

  if (ContentService && typeof ContentService.createTextOutput === 'function') {
    const out = ContentService.createTextOutput(content);
    // setMimeType is optional but signals JSON to API consumers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mime = (ContentService.MimeType as any)?.JSON;
    if (mime !== undefined && typeof (out as unknown as { setMimeType?: (m: unknown) => unknown }).setMimeType === 'function') {
      (out as unknown as { setMimeType: (m: unknown) => GoogleAppsScript.Content.TextOutput }).setMimeType(mime);
    }
    return out;
  }

  // Test fallback: plain object exposing both .getContent() and .content.
  return {
    getContent: () => content,
    content,
  } as unknown as GoogleAppsScript.Content.TextOutput;
}

// ---------------------------------------------------------------------------
// Default dependency resolution (GAS runtime only — not called in tests)
// ---------------------------------------------------------------------------

function resolveDeps(): Deps {
  return {
    drive: productionDriveOps as DriveOps,
    claude: { call: productionCallClaude } as ClaudeClient,
    prompt: { composeSystemPrompt: productionComposeSystemPrompt },
  };
}
