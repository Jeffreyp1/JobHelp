import {
  applyValidatorResumeEdits,
  applyScopedResumeEdits,
  getResumeOutline,
  type Critique,
  type ScopedReplacement,
  type ValidatorEdit,
  type ValidatorEdits,
} from '../../core/resumes/scoped-edit.js';
import type { Result } from '../../core/types/result.js';
import type { CoreDeps, ToolError, ToolHandler } from './tools-types.js';
import {
  buildHandler,
  errorResponse,
  isPlainObject,
  isNumber,
  isString,
  okResponse,
  unwrap,
} from './tools-helpers.js';

interface ApplyScopedResumeEditsArgs {
  readonly resumeMarkdown: string;
  readonly replacements: readonly ScopedReplacement[];
}

interface ApplyValidatorResumeEditsArgs {
  readonly resumeMarkdown: string;
  readonly critique: Critique;
  readonly edits: ValidatorEdits;
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

function parseApplyValidatorResumeEdits(
  obj: Record<string, unknown>,
): Result<ApplyValidatorResumeEditsArgs, ToolError> {
  if (!isString(obj['resumeMarkdown']) || obj['resumeMarkdown'].length === 0) {
    return bad('resumeMarkdown is required');
  }
  const critique = parseCritique(obj['critique']);
  if (!critique.ok) return critique;
  const edits = parseValidatorEdits(obj['edits']);
  if (!edits.ok) return edits;
  return { ok: true, value: { resumeMarkdown: obj['resumeMarkdown'], critique: critique.value, edits: edits.value } };
}

function parseCritique(raw: unknown): Result<Critique, ToolError> {
  if (!isPlainObject(raw)) return bad('critique must be an object');
  if (raw['schemaVersion'] !== 1) return bad('critique.schemaVersion must be 1');
  if (!isString(raw['jobId']) || raw['jobId'].length === 0) return bad('critique.jobId is required');
  if (!isNumber(raw['resumeVersion'])) return bad('critique.resumeVersion must be a number');
  if (raw['verdict'] !== 'PASS' && raw['verdict'] !== 'BLOCK') {
    return bad('critique.verdict must be PASS or BLOCK');
  }
  if (!isPlainObject(raw['thresholdConfig'])) return bad('critique.thresholdConfig must be an object');
  const blockOn = raw['thresholdConfig']['blockOn'];
  if (!Array.isArray(blockOn) || !blockOn.every(isBlockSeverity)) {
    return bad('critique.thresholdConfig.blockOn must contain made-up/exaggerated values');
  }
  if (!isPlainObject(raw['counts'])) return bad('critique.counts must be an object');
  const counts = parseCounts(raw['counts']);
  if (!counts.ok) return counts;
  const flagged = raw['flagged'];
  if (!Array.isArray(flagged)) return bad('critique.flagged must be an array');
  const parsedFlags = [];
  for (const flag of flagged) {
    const parsed = parseCritiqueFlag(flag);
    if (!parsed.ok) return parsed;
    parsedFlags.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      jobId: raw['jobId'],
      resumeVersion: raw['resumeVersion'],
      verdict: raw['verdict'],
      thresholdConfig: { blockOn },
      counts: counts.value,
      flagged: parsedFlags,
    },
  };
}

function parseCounts(raw: Record<string, unknown>): Result<Critique['counts'], ToolError> {
  const keys = ['supported', 'fair-rephrase', 'exaggerated', 'made-up', 'total'] as const;
  const counts: Record<(typeof keys)[number], number> = {
    supported: 0,
    'fair-rephrase': 0,
    exaggerated: 0,
    'made-up': 0,
    total: 0,
  };
  for (const key of keys) {
    if (!isNumber(raw[key])) return bad(`critique.counts.${key} must be a number`);
    counts[key] = raw[key];
  }
  return { ok: true, value: counts };
}

function parseCritiqueFlag(raw: unknown): Result<Critique['flagged'][number], ToolError> {
  if (!isPlainObject(raw)) return bad('critique.flagged entries must be objects');
  if (!isNumber(raw['id'])) return bad('critique.flagged[].id must be a number');
  if (raw['severity'] !== 'made-up' && raw['severity'] !== 'exaggerated') {
    return bad('critique.flagged[].severity must be made-up or exaggerated');
  }
  if (!isString(raw['location'])) return bad('critique.flagged[].location must be a string');
  if (!isString(raw['draftText'])) return bad('critique.flagged[].draftText must be a string');
  if (raw['originalEvidence'] !== null && !isString(raw['originalEvidence'])) {
    return bad('critique.flagged[].originalEvidence must be a string or null');
  }
  if (!isString(raw['suggestedFix'])) return bad('critique.flagged[].suggestedFix must be a string');
  return {
    ok: true,
    value: {
      id: raw['id'],
      severity: raw['severity'],
      location: raw['location'],
      draftText: raw['draftText'],
      originalEvidence: raw['originalEvidence'],
      suggestedFix: raw['suggestedFix'],
    },
  };
}

function parseValidatorEdits(raw: unknown): Result<ValidatorEdits, ToolError> {
  if (!isPlainObject(raw)) return bad('edits must be an object');
  if (raw['mode'] !== 'edits') return bad('edits.mode must be edits');
  if (!Array.isArray(raw['edits'])) return bad('edits.edits must be an array');
  const edits: ValidatorEdit[] = [];
  for (const edit of raw['edits']) {
    if (!isPlainObject(edit)) return bad('edits.edits entries must be objects');
    if (!isNumber(edit['flagId'])) return bad('edits.edits[].flagId must be a number');
    if (edit['replaceWith'] !== null && !isString(edit['replaceWith'])) {
      return bad('edits.edits[].replaceWith must be a string or null');
    }
    edits.push({ flagId: edit['flagId'], replaceWith: edit['replaceWith'] });
  }
  return { ok: true, value: { mode: 'edits', edits } };
}

function isBlockSeverity(value: unknown): value is 'made-up' | 'exaggerated' {
  return value === 'made-up' || value === 'exaggerated';
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
    buildHandler({
      name: 'apply_validator_resume_edits',
      description:
        'Apply validator flagId edits and return auditable PASS/BLOCK trust evidence for the resulting resume.',
      inputSchema: {
        type: 'object',
        properties: {
          resumeMarkdown: { type: 'string' },
          critique: { type: 'object' },
          edits: { type: 'object' },
        },
        required: ['resumeMarkdown', 'critique', 'edits'],
        additionalProperties: false,
      },
      parse: parseApplyValidatorResumeEdits,
      run: async (args) =>
        okResponse(
          applyValidatorResumeEdits({
            prevContent: args.resumeMarkdown,
            critique: args.critique,
            edits: args.edits,
          }),
        ),
    }),
  ];
}
