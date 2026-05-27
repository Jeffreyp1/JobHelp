import type { CoreDeps, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import { parseApplyConfigAnswers, parseInitConfig } from './tools-parsers.js';

export function createConfigTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'init_config',
      description:
        'First-run helper. With interactive=true, returns wizard prompts for ~/.config/jobhelp/config.json. After apply_config_answers, use register_resume to create an active selectable resume.',
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
        'Persist the answers gathered during init_config to ~/.config/jobhelp/config.json. Call this after collecting all profile/sources/rules/output answers from the user, then register the resume path/content. Idempotent — overwrites existing config.',
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
  ];
}
