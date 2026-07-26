import type { CoreDeps, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import {
  parseEmpty,
  parseListApplicationVersions,
  parseRecordJobVerdicts,
  parseStartApplication,
  parseWriteApplicationOutput,
} from './tools-parsers.js';
import { JOB_VERDICTS } from '../../core/state/index.js';

const KIND_ENUM = ['resume', 'cover-letter', 'critique', 'notes'] as const;

export function createApplicationTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'start_application',
      description:
        'Create ~/jobhelp/applications/{company-role-date}/ if missing. Idempotent. Records which registered resume the application was based on.',
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          company: { type: 'string' },
          role: { type: 'string' },
          title: { type: 'string' },
          jobDescription: { type: 'string' },
          description: { type: 'string' },
          url: { type: 'string' },
          location: { type: 'string' },
          basedOnResumeName: { type: 'string' },
        },
        required: [],
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
      name: 'record_job_verdicts',
      description:
        'Persist per-job judgments after a rerank so future rankings honor them: drop suppresses ' +
        'the same role in later digests, skipped demotes it, others are informational. Each item is ' +
        '{jobId, verdict, reason?}; jobId must come from the latest digest. Unknown jobIds are ' +
        'returned as unresolvedIds, not errors.',
      inputSchema: {
        type: 'object',
        properties: {
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                jobId: { type: 'string' },
                verdict: { type: 'string', enum: JOB_VERDICTS },
                reason: { type: 'string' },
              },
              required: ['jobId', 'verdict'],
              additionalProperties: false,
            },
          },
        },
        required: ['verdicts'],
        additionalProperties: false,
      },
      parse: parseRecordJobVerdicts,
      run: async (args) => unwrap(await deps.recordJobVerdicts(args)),
    }),
  ];
}
