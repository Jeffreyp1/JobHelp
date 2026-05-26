import type { JobId } from '../../core/types/job.js';
import type { CoreDeps, RulesMode, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import { parseEmpty, parseFindMatchingJobs, parseGetJob, parseReadRules } from './tools-parsers.js';

const MODE_ENUM = ['defaults', 'user', 'merged'] as const;

export function createJobTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'find_matching_jobs',
      description:
        'Discover and rank jobs against the active or named resume. count controls how many top-ranked jobs are returned and persisted. queries is accepted as optional caller context but does not filter sources. instructions is free-text guidance. maxAgeDays and recencyEnabled are per-call overrides that win over the persistent config for this call only.',
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
  ];
}
