import type { JobId } from '../../core/types/job.js';
import type { CoreDeps, RulesMode, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import {
  parseAnalyzeFit,
  parseEmpty,
  parseFindMatchingJobs,
  parseGetJob,
  parseGetTriageList,
  parseReadRules,
} from './tools-parsers.js';

const MODE_ENUM = ['defaults', 'user', 'merged'] as const;

export function createJobTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'find_matching_jobs',
      description:
        'Discover and rank jobs against the active or named resume. The returned ranking is RAW and deterministic (BM25 keyword + recency) — it is NOT a recommendation list, and you MUST rerank it against the resume (job-rerank skill or rerank_top_jobs) before presenting jobs to the user; the result\'s nextRequiredStep field restates this. count controls how many top-ranked jobs are returned and persisted. queries is accepted as optional caller context but does not filter sources. instructions is free-text guidance. maxAgeDays and recencyEnabled are per-call overrides that win over the persistent config for this call only.',
      inputSchema: {
        type: 'object',
        properties: {
          resumeName: { type: 'string' },
          useAllResumes: { type: 'boolean' },
          queries: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
          count: { type: 'integer', minimum: 1 },
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
        additionalProperties: false,
      },
      parse: parseFindMatchingJobs,
      run: async (args) => unwrap(await deps.findMatchingJobs(args)),
    }),
    buildHandler({
      name: 'get_latest_digest',
      description:
        'Return the most recent persisted digest. Its job order is the RAW deterministic ranking — rerank against the resume (job-rerank skill or rerank_top_jobs) before presenting jobs to the user.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parse: parseEmpty,
      run: async () => unwrap(await deps.getLatestDigest()),
    }),
    buildHandler({
      name: 'get_triage_list',
      description:
        'Return the ENTIRE persisted ranking as compact one-line-per-job entries (~55 tokens each) plus a ' +
        'profileCard, so every retrieved job can be skimmed cheaply. This is the funnel skim stage: chunk ' +
        'lines by triage.chunkSize, tier each chunk with a subagent running triage.model (Stage-1 ' +
        'dealbreakers, then strong/solid/borderline/drop), then deep-rerank survivors via ' +
        'rerank_top_jobs({ jobIds }). triageK caps how many lines are returned (default from config, ' +
        'usually 1000). Never present these lines directly to the user.',
      inputSchema: {
        type: 'object',
        properties: {
          triageK: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
      parse: parseGetTriageList,
      run: async (args) => unwrap(await deps.getTriageList(args)),
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
    buildHandler({
      name: 'analyze_fit',
      description:
        'Compare the active resume against a job from a recent digest. Returns the recognized skills the job mentions that the resume covers (matched), the recognized job skills absent from the resume (missing), and counts (matchedCount of jobSkillCount). Every recognized skill is weighted equally; these are not must-have vs nice-to-have. Descriptive only: it does not recommend whether to apply.',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
        additionalProperties: false,
      },
      parse: parseAnalyzeFit,
      run: async (args) => unwrap(await deps.analyzeFit(args)),
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
  ];
}
