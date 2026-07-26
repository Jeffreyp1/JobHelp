import type { CoreDeps, ToolHandler } from './tools-types.js';
import { createConfigTools } from './tools-config.js';
import { createResumeTools } from './tools-resume.js';
import { createScopedResumeTools } from './tools-scoped-resume.js';
import { createJobTools } from './tools-job.js';
import { createApplicationTools } from './tools-application.js';
import { createBatchTools } from './tools-batch.js';
import { createMetaTools } from './tools-meta.js';

export type {
  AnalyzeFitArgs,
  AnalyzeFitResult,
  ApplicationKind,
  ApplicationVersion,
  ApplyConfigAnswersArgs,
  ApplyConfigAnswersResult,
  CoreDeps,
  FindMatchingJobsArgs,
  FindMatchingJobsResult,
  GetJobResult,
  GetLatestDigestResult,
  InitConfigArgs,
  InitConfigResult,
  JobVerdictInput,
  ListApplicationVersionsArgs,
  ListApplicationVersionsResult,
  ListRecentApplicationsResult,
  RecordJobVerdictsArgs,
  RecordJobVerdictsResult,
  ReadResumeResult,
  ReadRulesArgs,
  ReadRulesResult,
  RecentApplication,
  RegisterResumeArgs,
  RegisterResumeResult,
  RerankJobSummary,
  RerankTopJobsArgs,
  RerankTopJobsResult,
  RuleFile,
  RulesMode,
  ScoreKeywordMatchArgs,
  ScoreKeywordMatchResult,
  SetActiveResumeArgs,
  SetActiveResumeResult,
  SourceValidationResultItem,
  SourceWarning,
  StartApplicationArgs,
  StartApplicationResult,
  ToolCallContentItem,
  ToolCallResponse,
  ToolDefinition,
  ToolError,
  ToolHandler,
  ToolJsonSchema,
  ValidateSourcesArgs,
  ValidateSourcesResult,
  ValidateSourcesSummary,
  WriteApplicationOutputArgs,
  WriteApplicationOutputResult,
} from './tools-types.js';

export function createTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    ...createConfigTools(deps),
    ...createResumeTools(deps),
    ...createScopedResumeTools(deps),
    ...createJobTools(deps),
    ...createBatchTools(deps),
    ...createApplicationTools(deps),
    ...createMetaTools(deps),
  ];
}
