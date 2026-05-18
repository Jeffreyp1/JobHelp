import type { CoreDeps, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import {
  parseEmpty,
  parseRegisterResume,
  parseScoreKeywordMatch,
  parseSetActiveResume,
} from './tools-parsers.js';

export function createResumeTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
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
  ];
}
