import type { JobId } from '../../core/types/job.js';
import type { CoreDeps, RulesMode, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import {
  parseApplyConfigAnswers,
  parseEmpty,
  parseFindMatchingJobs,
  parseGetJob,
  parseInitConfig,
  parseListApplicationVersions,
  parseReadRules,
  parseRegisterResume,
  parseScoreKeywordMatch,
  parseSetActiveResume,
  parseStartApplication,
  parseValidateSources,
  parseWriteApplicationOutput,
} from './tools-parsers.js';

export type {
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
  ListApplicationVersionsArgs,
  ListApplicationVersionsResult,
  ListRecentApplicationsResult,
  ReadResumeResult,
  ReadRulesArgs,
  ReadRulesResult,
  RecentApplication,
  RegisterResumeArgs,
  RegisterResumeResult,
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

const KIND_ENUM = ['resume', 'cover-letter', 'critique', 'notes'] as const;
const MODE_ENUM = ['defaults', 'user', 'merged'] as const;

export function createTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'init_config',
      description:
        'First-run helper. Creates ~/.config/jobhelp/config.json. With interactive=true, walks the user through fields. Either works.',
      inputSchema: {
        type: 'object',
        properties: { interactive: { type: 'boolean' } },
        additionalProperties: false,
      },
      parse: parseInitConfig,
      run: async (args) => unwrap(await deps.initConfig(args)),
    }),
    buildHandler({
      name: 'apply_config_answers',
      description:
        'Persist the answers gathered during init_config to ~/.config/jobhelp/config.json. Call this after collecting all profile/sources/rules/output answers from the user. Idempotent — overwrites existing config.',
      inputSchema: {
        type: 'object',
        properties: {
          answers: { type: 'object', additionalProperties: true },
          outputPath: { type: 'string' },
        },
        required: ['answers'],
        additionalProperties: false,
      },
      parse: parseApplyConfigAnswers,
      run: async (args) => unwrap(await deps.applyConfigAnswers(args)),
    }),
    buildHandler({
      name: 'register_resume',
      description:
        'Register a resume under a friendly name. Pass content (markdown) or path. Same name overwrites.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      parse: parseRegisterResume,
      run: async (args) => unwrap(await deps.registerResume(args)),
    }),
    buildHandler({
      name: 'set_active_resume',
      description:
        'Switch the active resume. With no name, returns the list of registered resumes for the AI to surface.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      },
      parse: parseSetActiveResume,
      run: async (args) => unwrap(await deps.setActiveResume(args)),
    }),
    buildHandler({
      name: 'find_matching_jobs',
      description:
        'Discover and rank jobs against the active or named resume. queries is the inline list of search strings, instructions is free-text guidance. maxAgeDays and recencyEnabled are per-call overrides that win over the persistent config for this call only.',
      inputSchema: {
        type: 'object',
        properties: {
          resumeName: { type: 'string' },
          useAllResumes: { type: 'boolean' },
          queries: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
          count: { type: 'number' },
          maxAgeDays: {
            type: ['number', 'null'],
            description:
              'Per-call age cutoff in days. Must be a positive number, or null to disable the age filter for this call.',
          },
          recencyEnabled: {
            type: 'boolean',
            description: 'Per-call override for recency decay (true/false to toggle for this call only).',
          },
        },
        required: ['queries'],
        additionalProperties: false,
      },
      parse: parseFindMatchingJobs,
      run: async (args) => unwrap(await deps.findMatchingJobs(args)),
    }),
    buildHandler({
      name: 'get_latest_digest',
      description: 'Return the most recent persisted digest.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parse: parseEmpty,
      run: async () => unwrap(await deps.getLatestDigest()),
    }),
    buildHandler({
      name: 'get_job',
      description: 'Return a NormalizedJob by id from a recent digest run.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      parse: parseGetJob,
      run: async (args) => unwrap(await deps.getJob(args.id as JobId)),
    }),
    buildHandler<{ mode: RulesMode }>({
      name: 'read_rules',
      description: "Return rule files. Mode: defaults, user, or merged (default 'merged').",
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: MODE_ENUM } },
        additionalProperties: false,
      },
      parse: parseReadRules,
      run: async (args) => unwrap(await deps.readRules(args.mode)),
    }),
    buildHandler({
      name: 'read_resume',
      description: 'Return the active resume content.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parse: parseEmpty,
      run: async () => unwrap(await deps.readResume()),
    }),
    buildHandler({
      name: 'score_keyword_match',
      description: 'Deterministic 0..1 overlap score for the client to verify ATS coverage.',
      inputSchema: {
        type: 'object',
        properties: {
          resumeMarkdown: { type: 'string' },
          jobId: { type: 'string' },
        },
        required: ['resumeMarkdown', 'jobId'],
        additionalProperties: false,
      },
      parse: parseScoreKeywordMatch,
      run: async (args) => unwrap(await deps.scoreKeywordMatch(args)),
    }),
    buildHandler({
      name: 'start_application',
      description:
        'Create ~/jobhelp/applications/{company-role-date}/ if missing. Idempotent. Records which registered resume the application was based on.',
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          basedOnResumeName: { type: 'string' },
        },
        required: ['jobId'],
        additionalProperties: false,
      },
      parse: parseStartApplication,
      run: async (args) => unwrap(await deps.startApplication(args)),
    }),
    buildHandler({
      name: 'write_application_output',
      description:
        'Write an artifact for an application. kind in {resume, cover-letter, critique, notes}. resume/cover-letter are versioned (v1, v2, ...); critique/notes overwrite.',
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          kind: { type: 'string', enum: KIND_ENUM },
          content: { type: 'string' },
        },
        required: ['jobId', 'kind', 'content'],
        additionalProperties: false,
      },
      parse: parseWriteApplicationOutput,
      run: async (args) => unwrap(await deps.writeApplicationOutput(args)),
    }),
    buildHandler({
      name: 'list_application_versions',
      description: 'List versions for diff/recovery.',
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          kind: { type: 'string', enum: KIND_ENUM },
        },
        required: ['jobId', 'kind'],
        additionalProperties: false,
      },
      parse: parseListApplicationVersions,
      run: async (args) => unwrap(await deps.listApplicationVersions(args)),
    }),
    buildHandler({
      name: 'list_recent_applications',
      description: 'Return history from ~/jobhelp/state.json.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parse: parseEmpty,
      run: async () => unwrap(await deps.listRecentApplications()),
    }),
    buildHandler({
      name: 'validate_sources',
      description:
        'Ping each configured source adapter (Greenhouse tokens, Lever slugs, Adzuna credentials, Remotive, RemoteOK) and report per-source health: ok/failed, statusCode, jobCount, durationMs. Use this at config time to catch stale tokens, expired credentials, or rate limits before they silently produce empty digests.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['adzuna', 'greenhouse', 'lever', 'remotive', 'remoteok'],
            description: 'Optional adapter name to validate only that source. Omit to validate all configured adapters.',
          },
        },
        additionalProperties: false,
      },
      parse: parseValidateSources,
      run: async (args) => unwrap(await deps.validateSources(args)),
    }),
  ];
}
