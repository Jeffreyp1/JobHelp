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
  PingResponse,
  ApiError,
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
}
