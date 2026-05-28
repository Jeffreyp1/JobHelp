import { postToAppsScript } from './apiClient-post.js';
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
  ResearchCompanyRequest,
  ResearchCompanyResponse,
  BenchmarkRoleRequest,
  BenchmarkRoleResponse,
  CritiqueRequest,
  CritiqueResponse,
  AutoReviseRequest,
  AutoReviseResponse,
  AutoReviseScopedRequest,
  AutoReviseScopedResponse,
  CoverLetterRequest,
  CoverLetterResponse,
  VerifyClHooksRequest,
  VerifyClHooksResponse,
  MultiVersionRequest,
  MultiVersionResponse,
  ExtractProfileRequest,
  ExtractProfileResponse,
  DiscoverAndRankRequest,
  DiscoverAndRankResponse,
  UpdateJobStatusRequest,
  UpdateJobStatusResponse,
} from '../types/api-contract.js';

export class ApiClient {
  constructor(private readonly appsScriptUrl: string) {}

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    return postToAppsScript<T>(this.appsScriptUrl, body);
  }

  async generate(req: Omit<GenerateRequest, 'action'>): Promise<GenerateResponse> {
    return this.post<GenerateResponse>({ action: 'generate', ...req });
  }

  async listFiles(req: Omit<ListFilesRequest, 'action'>): Promise<ListFilesResponse> {
    return this.post<ListFilesResponse>({ action: 'list_files', ...req });
  }

  async writeFile(req: Omit<WriteFileRequest, 'action'>): Promise<WriteFileResponse> {
    return this.post<WriteFileResponse>({ action: 'write_file', ...req });
  }

  async seedDefaults(req: Omit<SeedDefaultsRequest, 'action'>): Promise<SeedDefaultsResponse> {
    return this.post<SeedDefaultsResponse>({ action: 'seed_defaults', ...req });
  }

  async ping(): Promise<PingResponse> {
    return this.post<PingResponse>({ action: 'ping' });
  }

  async finalize(req: Omit<FinalizeRequest, 'action'>): Promise<FinalizeResponse> {
    return this.post<FinalizeResponse>({ action: 'finalize', ...req });
  }

  async downloadTemplate(
    req: Omit<DownloadTemplateRequest, 'action'>,
  ): Promise<DownloadTemplateResponse> {
    return this.post<DownloadTemplateResponse>({ action: 'download_template', ...req });
  }

  async uploadFilledDocx(
    req: Omit<UploadFilledDocxRequest, 'action'>,
  ): Promise<UploadFilledDocxResponse> {
    return this.post<UploadFilledDocxResponse>({ action: 'upload_filled_docx', ...req });
  }

  async createDriveFile(
    req: Omit<CreateDriveFileRequest, 'action'>,
  ): Promise<CreateDriveFileResponse> {
    return this.post<CreateDriveFileResponse>({ action: 'create_drive_file', ...req });
  }

  async researchCompany(
    req: Omit<ResearchCompanyRequest, 'action'>,
  ): Promise<ResearchCompanyResponse> {
    return this.post<ResearchCompanyResponse>({ action: 'research_company', ...req });
  }

  async benchmarkRole(
    req: Omit<BenchmarkRoleRequest, 'action'>,
  ): Promise<BenchmarkRoleResponse> {
    return this.post<BenchmarkRoleResponse>({ action: 'benchmark_role', ...req });
  }

  async critique(
    req: Omit<CritiqueRequest, 'action'>,
  ): Promise<CritiqueResponse> {
    return this.post<CritiqueResponse>({ action: 'critique', ...req });
  }

  async autoRevise(
    req: Omit<AutoReviseRequest, 'action'>,
  ): Promise<AutoReviseResponse> {
    return this.post<AutoReviseResponse>({ action: 'auto_revise', ...req });
  }

  async autoReviseScoped(
    req: AutoReviseScopedRequest,
  ): Promise<AutoReviseScopedResponse> {
    return this.post<AutoReviseScopedResponse>({ action: 'auto_revise_scoped', ...req });
  }

  async coverLetter(
    req: Omit<CoverLetterRequest, 'action'>,
  ): Promise<CoverLetterResponse> {
    return this.post<CoverLetterResponse>({ action: 'cover_letter', ...req });
  }

  async verifyClHooks(
    req: Omit<VerifyClHooksRequest, 'action'>,
  ): Promise<VerifyClHooksResponse> {
    return this.post<VerifyClHooksResponse>({ action: 'verify_cl_hooks', ...req });
  }

  async multiVersion(
    req: Omit<MultiVersionRequest, 'action'>,
  ): Promise<MultiVersionResponse> {
    return this.post<MultiVersionResponse>({ action: 'multi_version', ...req });
  }

  async extractProfile(
    req: Omit<ExtractProfileRequest, 'action'>,
  ): Promise<ExtractProfileResponse> {
    return this.post<ExtractProfileResponse>({ action: 'extract_profile', ...req });
  }

  async discoverAndRank(
    req: Omit<DiscoverAndRankRequest, 'action'>,
  ): Promise<DiscoverAndRankResponse> {
    return this.post<DiscoverAndRankResponse>({ action: 'discover_and_rank', ...req });
  }

  async updateJobStatus(
    req: Omit<UpdateJobStatusRequest, 'action'>,
  ): Promise<UpdateJobStatusResponse> {
    return this.post<UpdateJobStatusResponse>({ action: 'update_job_status', ...req });
  }
}
