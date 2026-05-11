/**
 * apiClient.ts
 *
 * HTTP client for the Apps Script web app backend.
 * All network calls go through this class so the rest of the extension
 * never has to deal with raw fetch / error shapes.
 */

import type {
  GenerateRequest,
  GenerateResponse,
  FinalizeRequest,
  FinalizeResponse,
  ListFilesRequest,
  ListFilesResponse,
  WriteFileRequest,
  WriteFileResponse,
  SeedDefaultsRequest,
  SeedDefaultsResponse,
  DownloadTemplateRequest,
  DownloadTemplateResponse,
  UploadFilledDocxRequest,
  UploadFilledDocxResponse,
  CreateDriveFileRequest,
  CreateDriveFileResponse,
  PingResponse,
  ApiError,
  ResearchCompanyRequest,
  ResearchCompanyResponse,
  BenchmarkRoleRequest,
  BenchmarkRoleResponse,
  CritiqueRequest,
  CritiqueResponse,
  AutoReviseRequest,
  AutoReviseResponse,
  CoverLetterRequest,
  CoverLetterResponse,
  VerifyClHooksRequest,
  VerifyClHooksResponse,
  MultiVersionRequest,
  MultiVersionResponse,
} from '../types/api-contract.js';

/** Build a typed network-failure error response. */
function networkError(message: string): { ok: false; error: ApiError } {
  return {
    ok: false,
    error: {
      type: 'server',
      message,
      retryable: true,
    },
  };
}

export class ApiClient {
  constructor(private readonly appsScriptUrl: string) {}

  /** POST a request body to the Apps Script endpoint and parse JSON response. */
  private async post<T>(body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (offline, DNS, CORS hard block, etc.)
      const message = (err as Error)?.message ?? 'Network request failed';
      return networkError(message) as T;
    }

    // HTTP-level errors (4xx/5xx from the reverse-proxy, not from Apps Script)
    if (!response.ok) {
      return networkError(`HTTP ${response.status}: ${response.statusText}`) as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Trigger the generate pipeline on the backend.
   * Returns a GenerateResponse (ok:true with result, or ok:false with error).
   */
  async generate(req: Omit<GenerateRequest, 'action'>): Promise<GenerateResponse> {
    return this.post<GenerateResponse>({ action: 'generate', ...req });
  }

  /** List files in a Drive folder (source or rules). */
  async listFiles(req: Omit<ListFilesRequest, 'action'>): Promise<ListFilesResponse> {
    return this.post<ListFilesResponse>({ action: 'list_files', ...req });
  }

  /** Overwrite a Drive file's contents. */
  async writeFile(req: Omit<WriteFileRequest, 'action'>): Promise<WriteFileResponse> {
    return this.post<WriteFileResponse>({ action: 'write_file', ...req });
  }

  /** Seed the user's rules folder with default prompt files from GitHub. */
  async seedDefaults(req: Omit<SeedDefaultsRequest, 'action'>): Promise<SeedDefaultsResponse> {
    return this.post<SeedDefaultsResponse>({ action: 'seed_defaults', ...req });
  }

  /** Health check — verifies the Apps Script endpoint is reachable. */
  async ping(): Promise<PingResponse> {
    return this.post<PingResponse>({ action: 'ping' });
  }

  /**
   * Convert the (possibly user-edited) markdown to DOCX and/or PDF.
   * Updates the existing tailored_resume Doc, then exports to the requested
   * formats into the same job folder.
   */
  async finalize(req: Omit<FinalizeRequest, 'action'>): Promise<FinalizeResponse> {
    return this.post<FinalizeResponse>({ action: 'finalize', ...req });
  }

  /**
   * Download the user's uploaded resume template DOCX from Drive as base64.
   * Used by the "Convert via Template (DOCX)" flow before client-side fill.
   */
  async downloadTemplate(
    req: Omit<DownloadTemplateRequest, 'action'>,
  ): Promise<DownloadTemplateResponse> {
    return this.post<DownloadTemplateResponse>({ action: 'download_template', ...req });
  }

  /**
   * Upload a base64-encoded DOCX (the result of fillResumeTemplate) into a
   * Drive folder and return the resulting file URL.
   */
  async uploadFilledDocx(
    req: Omit<UploadFilledDocxRequest, 'action'>,
  ): Promise<UploadFilledDocxResponse> {
    return this.post<UploadFilledDocxResponse>({ action: 'upload_filled_docx', ...req });
  }

  /**
   * Create a brand-new file in the user's Drive. Used by the v2.1 onboarding
   * wizard to scaffold `jobhelp-config.json` (defaults: application/json,
   * Drive root). Pass `parentFolderId` to drop the file into a specific
   * folder, or override `mimeType` for non-JSON scaffolds.
   */
  async createDriveFile(
    req: Omit<CreateDriveFileRequest, 'action'>,
  ): Promise<CreateDriveFileResponse> {
    return this.post<CreateDriveFileResponse>({ action: 'create_drive_file', ...req });
  }

  // ─── feature owner: E1 ───────────────────────────────────────────────────

  /**
   * Research a company using live web search and return a structured summary.
   * Results are cached server-side for 24h keyed by company+role.
   */
  async researchCompany(
    req: Omit<ResearchCompanyRequest, 'action'>,
  ): Promise<ResearchCompanyResponse> {
    return this.post<ResearchCompanyResponse>({ action: 'research_company', ...req });
  }

  /**
   * Benchmark a role at a company using LinkedIn-style profile patterns.
   * Results are cached server-side for 24h keyed by company+role.
   */
  async benchmarkRole(
    req: Omit<BenchmarkRoleRequest, 'action'>,
  ): Promise<BenchmarkRoleResponse> {
    return this.post<BenchmarkRoleResponse>({ action: 'benchmark_role', ...req });
  }

  // ─── feature owner: E2 ───────────────────────────────────────────────────

  /**
   * Run the 8-dimension critique framework on a generated resume.
   * Optionally saves critique.md to the job folder in Drive.
   */
  async critique(
    req: Omit<CritiqueRequest, 'action'>,
  ): Promise<CritiqueResponse> {
    return this.post<CritiqueResponse>({ action: 'critique', ...req });
  }

  /**
   * Revise a specific bullet, section, role, or the whole resume with
   * surgical precision (rule 14-revision-discipline enforced server-side).
   * Returns the revised markdown plus a line-level diff for user approval.
   */
  async autoRevise(
    req: Omit<AutoReviseRequest, 'action'>,
  ): Promise<AutoReviseResponse> {
    return this.post<AutoReviseResponse>({ action: 'auto_revise', ...req });
  }

  // ─── feature owner: E3 ───────────────────────────────────────────────────

  /**
   * Generate a HOOK/EVIDENCE/CLOSING cover letter (250-300 words) from the
   * candidate's resume + JD. Saves both .md and Google Doc to the job folder.
   */
  async coverLetter(
    req: Omit<CoverLetterRequest, 'action'>,
  ): Promise<CoverLetterResponse> {
    return this.post<CoverLetterResponse>({ action: 'cover_letter', ...req });
  }

  /**
   * Scan a cover letter for named entities and verify each via web search.
   * Unverified entities are tagged inline with [⚠ UNVERIFIED].
   */
  async verifyClHooks(
    req: Omit<VerifyClHooksRequest, 'action'>,
  ): Promise<VerifyClHooksResponse> {
    return this.post<VerifyClHooksResponse>({ action: 'verify_cl_hooks', ...req });
  }

  // ─── feature owner: E4 ───────────────────────────────────────────────────

  /**
   * Generate N resume variants in parallel (fan-out), each with a different
   * framing directive. Returns all variants for user selection.
   */
  async multiVersion(
    req: Omit<MultiVersionRequest, 'action'>,
  ): Promise<MultiVersionResponse> {
    return this.post<MultiVersionResponse>({ action: 'multi_version', ...req });
  }
}
