import type { Result } from '../../core/types/result.js';
import type {
  ApplicationKind,
  ApplyConfigAnswersArgs,
  FindMatchingJobsArgs,
  InitConfigArgs,
  ListApplicationVersionsArgs,
  RegisterResumeArgs,
  RulesMode,
  ScoreKeywordMatchArgs,
  SetActiveResumeArgs,
  StartApplicationArgs,
  ToolError,
  ValidateSourcesArgs,
  WriteApplicationOutputArgs,
} from './tools-types.js';
import {
  getOptional,
  isApplicationKind,
  isBoolean,
  isNumber,
  isPlainObject,
  isRulesMode,
  isString,
  isStringArray,
} from './tools-helpers.js';

function bad(message: string): Result<never, ToolError> {
  return { ok: false, error: { type: 'invalid_input', message } };
}

export function parseInitConfig(
  obj: Record<string, unknown>,
): Result<InitConfigArgs, ToolError> {
  const out: { interactive?: boolean } = {};
  const interactive = getOptional(obj, 'interactive', isBoolean);
  if (interactive !== undefined) out.interactive = interactive;
  return { ok: true, value: out };
}

export function parseApplyConfigAnswers(
  obj: Record<string, unknown>,
): Result<ApplyConfigAnswersArgs, ToolError> {
  const answers = obj['answers'];
  if (!isPlainObject(answers)) return bad('answers must be an object');
  const out: { answers: Record<string, unknown>; outputPath?: string } = { answers };
  const outputPath = getOptional(obj, 'outputPath', isString);
  if (outputPath !== undefined) out.outputPath = outputPath;
  return { ok: true, value: out };
}

export function parseRegisterResume(
  obj: Record<string, unknown>,
): Result<RegisterResumeArgs, ToolError> {
  if (!isString(obj['name']) || obj['name'].length === 0) {
    return bad('name is required');
  }
  const out: { name: string; path?: string; content?: string } = { name: obj['name'] };
  const path = getOptional(obj, 'path', isString);
  if (path !== undefined) out.path = path;
  const content = getOptional(obj, 'content', isString);
  if (content !== undefined) out.content = content;
  if (out.path === undefined && out.content === undefined) {
    return bad('either path or content is required');
  }
  return { ok: true, value: out };
}

export function parseSetActiveResume(
  obj: Record<string, unknown>,
): Result<SetActiveResumeArgs, ToolError> {
  const out: { name?: string } = {};
  const name = getOptional(obj, 'name', isString);
  if (name !== undefined) out.name = name;
  return { ok: true, value: out };
}

export function parseFindMatchingJobs(
  obj: Record<string, unknown>,
): Result<FindMatchingJobsArgs, ToolError> {
  const queries = obj['queries'];
  if (!isStringArray(queries)) return bad('queries must be a string array');
  const out: {
    queries: readonly string[];
    resumeName?: string;
    useAllResumes?: boolean;
    instructions?: string;
    count?: number;
    maxAgeDays?: number | null;
    recencyEnabled?: boolean;
  } = { queries };
  const resumeName = getOptional(obj, 'resumeName', isString);
  if (resumeName !== undefined) out.resumeName = resumeName;
  const useAllResumes = getOptional(obj, 'useAllResumes', isBoolean);
  if (useAllResumes !== undefined) out.useAllResumes = useAllResumes;
  const instructions = getOptional(obj, 'instructions', isString);
  if (instructions !== undefined) out.instructions = instructions;
  const count = getOptional(obj, 'count', isNumber);
  if (count !== undefined) out.count = count;
  if ('maxAgeDays' in obj) {
    const raw = obj['maxAgeDays'];
    if (raw === null) {
      out.maxAgeDays = null;
    } else if (raw !== undefined) {
      if (!isNumber(raw) || raw <= 0) return bad('maxAgeDays must be a positive number or null');
      out.maxAgeDays = raw;
    }
  }
  const recencyEnabled = getOptional(obj, 'recencyEnabled', isBoolean);
  if (recencyEnabled !== undefined) out.recencyEnabled = recencyEnabled;
  return { ok: true, value: out };
}

export function parseGetJob(
  obj: Record<string, unknown>,
): Result<{ id: string }, ToolError> {
  if (!isString(obj['id']) || obj['id'].length === 0) return bad('id is required');
  return { ok: true, value: { id: obj['id'] } };
}

export function parseReadRules(
  obj: Record<string, unknown>,
): Result<{ mode: RulesMode }, ToolError> {
  const mode = obj['mode'];
  if (mode === undefined) return { ok: true, value: { mode: 'merged' as const } };
  if (!isRulesMode(mode)) return bad('mode must be one of: defaults, user, merged');
  return { ok: true, value: { mode } };
}

export function parseScoreKeywordMatch(
  obj: Record<string, unknown>,
): Result<ScoreKeywordMatchArgs, ToolError> {
  if (!isString(obj['resumeMarkdown']) || obj['resumeMarkdown'].length === 0) {
    return bad('resumeMarkdown is required');
  }
  if (!isString(obj['jobId']) || obj['jobId'].length === 0) return bad('jobId is required');
  return {
    ok: true,
    value: { resumeMarkdown: obj['resumeMarkdown'], jobId: obj['jobId'] },
  };
}

export function parseStartApplication(
  obj: Record<string, unknown>,
): Result<StartApplicationArgs, ToolError> {
  if (!isString(obj['jobId']) || obj['jobId'].length === 0) return bad('jobId is required');
  const out: { jobId: string; basedOnResumeName?: string } = { jobId: obj['jobId'] };
  const basedOnResumeName = getOptional(obj, 'basedOnResumeName', isString);
  if (basedOnResumeName !== undefined) out.basedOnResumeName = basedOnResumeName;
  return { ok: true, value: out };
}

function parseKind(v: unknown): Result<ApplicationKind, ToolError> {
  if (!isApplicationKind(v)) {
    return bad('kind must be one of: resume, cover-letter, critique, notes');
  }
  return { ok: true, value: v };
}

export function parseWriteApplicationOutput(
  obj: Record<string, unknown>,
): Result<WriteApplicationOutputArgs, ToolError> {
  if (!isString(obj['jobId']) || obj['jobId'].length === 0) return bad('jobId is required');
  const kindR = parseKind(obj['kind']);
  if (!kindR.ok) return kindR;
  if (!isString(obj['content'])) return bad('content must be a string');
  return {
    ok: true,
    value: { jobId: obj['jobId'], kind: kindR.value, content: obj['content'] },
  };
}

export function parseListApplicationVersions(
  obj: Record<string, unknown>,
): Result<ListApplicationVersionsArgs, ToolError> {
  if (!isString(obj['jobId']) || obj['jobId'].length === 0) return bad('jobId is required');
  const kindR = parseKind(obj['kind']);
  if (!kindR.ok) return kindR;
  return { ok: true, value: { jobId: obj['jobId'], kind: kindR.value } };
}

export function parseEmpty(_obj: Record<string, unknown>): Result<Record<string, never>, ToolError> {
  return { ok: true, value: {} };
}

const KNOWN_SOURCES = ['adzuna', 'greenhouse', 'lever', 'remotive', 'remoteok'] as const;

export function parseValidateSources(
  obj: Record<string, unknown>,
): Result<ValidateSourcesArgs, ToolError> {
  const out: { source?: string } = {};
  if ('source' in obj) {
    const raw = obj['source'];
    if (raw !== undefined) {
      if (!isString(raw)) return bad('source must be a string');
      if (!(KNOWN_SOURCES as readonly string[]).includes(raw)) {
        return bad(
          `unknown source "${raw}"; valid options are: ${KNOWN_SOURCES.join(', ')}`,
        );
      }
      out.source = raw;
    }
  }
  return { ok: true, value: out };
}
