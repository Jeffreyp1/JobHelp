import {
  applyScopedResumeEdits,
  getResumeOutline,
  type ScopedReplacement,
} from '../../core/resumes/scoped-edit.js';
import type { Result } from '../../core/types/result.js';
import type { CoreDeps, ToolError, ToolHandler } from './tools-types.js';
import {
  buildHandler,
  errorResponse,
  isPlainObject,
  isString,
  okResponse,
  unwrap,
} from './tools-helpers.js';

interface ApplyScopedResumeEditsArgs {
  readonly resumeMarkdown: string;
  readonly replacements: readonly ScopedReplacement[];
}

function bad(message: string): Result<never, ToolError> {
  return { ok: false, error: { type: 'invalid_input', message } };
}

function parseApplyScopedResumeEdits(
  obj: Record<string, unknown>,
): Result<ApplyScopedResumeEditsArgs, ToolError> {
  if (!isString(obj['resumeMarkdown']) || obj['resumeMarkdown'].length === 0) {
    return bad('resumeMarkdown is required');
  }
  const rawReplacements = obj['replacements'];
  if (!Array.isArray(rawReplacements) || rawReplacements.length === 0) {
    return bad('replacements must be a non-empty array');
  }

  const replacements: ScopedReplacement[] = [];
  for (const raw of rawReplacements) {
    if (!isPlainObject(raw)) return bad('each replacement must be an object');
    const selectionId = raw['selectionId'];
    const replacementMarkdown = raw['replacementMarkdown'];
    if (!isString(selectionId) || selectionId.length === 0) {
      return bad('replacement.selectionId is required');
    }
    if (!isString(replacementMarkdown) || replacementMarkdown.length === 0) {
      return bad('replacement.replacementMarkdown is required');
    }
    replacements.push({ selectionId, replacementMarkdown });
  }

  return { ok: true, value: { resumeMarkdown: obj['resumeMarkdown'], replacements } };
}

export function createScopedResumeTools(deps: Pick<CoreDeps, 'readResume'>): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'get_resume_outline',
      description:
        'Return stable selection ids for active resume sections and bullets so clients can edit only chosen parts.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parse: () => ({ ok: true, value: {} }),
      run: async () => {
        const resume = await deps.readResume();
        if (!resume.ok) return unwrap(resume);
        return okResponse({ resumeName: resume.value.name, ...getResumeOutline(resume.value.content) });
      },
    }),
    buildHandler({
      name: 'apply_scoped_resume_edits',
      description:
        'Apply section or bullet replacements by selection id while preserving every untouched resume line.',
      inputSchema: {
        type: 'object',
        properties: {
          resumeMarkdown: { type: 'string' },
          replacements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                selectionId: { type: 'string' },
                replacementMarkdown: { type: 'string' },
              },
              required: ['selectionId', 'replacementMarkdown'],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ['resumeMarkdown', 'replacements'],
        additionalProperties: false,
      },
      parse: parseApplyScopedResumeEdits,
      run: async (args) => {
        const applied = applyScopedResumeEdits(args.resumeMarkdown, {
          replacements: args.replacements,
        });
        if (!applied.ok) {
          return errorResponse({ type: applied.error.type, message: applied.error.message });
        }
        return okResponse(applied.value);
      },
    }),
  ];
}
