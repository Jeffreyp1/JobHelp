import type { Result } from '../../core/types/result.js';
import type { JobId, NormalizedJob } from '../../core/types/job.js';
import type { RankedJob } from '../../core/types/pipeline.js';

export interface InitConfigArgs {
  readonly interactive?: boolean;
}

export interface InitConfigResult {
  readonly created: boolean;
  readonly path: string;
}

export interface ApplyConfigAnswersArgs {
  readonly answers: Record<string, unknown>;
  readonly outputPath?: string;
}

export interface ApplyConfigAnswersResult {
  readonly path: string;
}

export interface RegisterResumeArgs {
  readonly name: string;
  readonly path?: string;
  readonly content?: string;
}

export interface RegisterResumeResult {
  readonly name: string;
  readonly storedAt: string;
  readonly active: boolean;
}

export interface SetActiveResumeArgs {
  readonly name?: string;
}

export interface SetActiveResumeResult {
  readonly active?: string;
  readonly registered: readonly string[];
}

export interface FindMatchingJobsArgs {
  readonly resumeName?: string;
  readonly useAllResumes?: boolean;
  readonly queries: readonly string[];
  readonly instructions?: string;
  readonly count?: number;
  /**
   * Per-call age cutoff in days. `null` disables the filter for this call;
   * a number overrides `config.ranking.maxAge.days` for this call only.
   */
  readonly maxAgeDays?: number | null;
  /** Per-call override for recency decay. */
  readonly recencyEnabled?: boolean;
}

export interface SourceWarning {
  readonly source: string;
  readonly message: string;
}

export interface FindMatchingJobsResult {
  readonly digestPath: string;
  readonly jobs: readonly RankedJob[];
  readonly warnings: readonly SourceWarning[];
}

export interface GetLatestDigestResult {
  readonly path: string;
  readonly jobs: readonly RankedJob[];
  readonly generatedAt: string;
}

export interface GetJobResult {
  readonly job: NormalizedJob;
}

export type RulesMode = 'defaults' | 'user' | 'merged';

export interface ReadRulesArgs {
  readonly mode?: RulesMode;
}

export interface RuleFile {
  readonly name: string;
  readonly content: string;
}

export interface ReadRulesResult {
  readonly mode: RulesMode;
  readonly files: readonly RuleFile[];
}

export interface ReadResumeResult {
  readonly name: string;
  readonly content: string;
}

export interface ScoreKeywordMatchArgs {
  readonly resumeMarkdown: string;
  readonly jobId: string;
}

export interface ScoreKeywordMatchResult {
  readonly score: number;
  readonly matched: readonly string[];
  readonly missing: readonly string[];
}

export interface StartApplicationArgs {
  readonly jobId: string;
  readonly basedOnResumeName?: string;
}

export interface StartApplicationResult {
  readonly path: string;
  readonly created: boolean;
  readonly basedOnResumeName?: string;
}

export type ApplicationKind = 'resume' | 'cover-letter' | 'critique' | 'notes';

export interface WriteApplicationOutputArgs {
  readonly jobId: string;
  readonly kind: ApplicationKind;
  readonly content: string;
}

export interface WriteApplicationOutputResult {
  readonly path: string;
  readonly version?: number;
}

export interface ListApplicationVersionsArgs {
  readonly jobId: string;
  readonly kind: ApplicationKind;
}

export interface ApplicationVersion {
  readonly version: number;
  readonly path: string;
  readonly writtenAt: string;
}

export interface ListApplicationVersionsResult {
  readonly versions: readonly ApplicationVersion[];
}

export interface RecentApplication {
  readonly jobId: string;
  readonly path: string;
  readonly company: string;
  readonly role: string;
  readonly startedAt: string;
  readonly basedOnResumeName?: string;
}

export interface ListRecentApplicationsResult {
  readonly applications: readonly RecentApplication[];
}

export interface ToolError {
  readonly type:
    | 'invalid_input'
    | 'not_configured'
    | 'not_found'
    | 'io_error'
    | 'all_sources_failed'
    | 'not_implemented'
    | 'internal';
  readonly message: string;
  readonly retryable?: boolean;
}

export interface CoreDeps {
  readonly initConfig: (args: InitConfigArgs) => Promise<Result<InitConfigResult, ToolError>>;
  readonly applyConfigAnswers: (
    args: ApplyConfigAnswersArgs,
  ) => Promise<Result<ApplyConfigAnswersResult, ToolError>>;
  readonly registerResume: (
    args: RegisterResumeArgs,
  ) => Promise<Result<RegisterResumeResult, ToolError>>;
  readonly setActiveResume: (
    args: SetActiveResumeArgs,
  ) => Promise<Result<SetActiveResumeResult, ToolError>>;
  readonly findMatchingJobs: (
    args: FindMatchingJobsArgs,
  ) => Promise<Result<FindMatchingJobsResult, ToolError>>;
  readonly getLatestDigest: () => Promise<Result<GetLatestDigestResult, ToolError>>;
  readonly getJob: (id: JobId) => Promise<Result<GetJobResult, ToolError>>;
  readonly readRules: (mode: RulesMode) => Promise<Result<ReadRulesResult, ToolError>>;
  readonly readResume: () => Promise<Result<ReadResumeResult, ToolError>>;
  readonly scoreKeywordMatch: (
    args: ScoreKeywordMatchArgs,
  ) => Promise<Result<ScoreKeywordMatchResult, ToolError>>;
  readonly startApplication: (
    args: StartApplicationArgs,
  ) => Promise<Result<StartApplicationResult, ToolError>>;
  readonly writeApplicationOutput: (
    args: WriteApplicationOutputArgs,
  ) => Promise<Result<WriteApplicationOutputResult, ToolError>>;
  readonly listApplicationVersions: (
    args: ListApplicationVersionsArgs,
  ) => Promise<Result<ListApplicationVersionsResult, ToolError>>;
  readonly listRecentApplications: () => Promise<
    Result<ListRecentApplicationsResult, ToolError>
  >;
}

export interface ToolJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
}

export interface ToolCallContentItem {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolCallResponse {
  readonly content: readonly ToolCallContentItem[];
  readonly isError?: boolean;
}

export interface ToolHandler {
  readonly definition: ToolDefinition;
  readonly invoke: (rawArgs: unknown) => Promise<ToolCallResponse>;
}
