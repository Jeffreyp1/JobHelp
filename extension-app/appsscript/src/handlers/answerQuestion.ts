/**
 * @file handlers/answerQuestion.ts
 *
 * Feature: Answer application question (action: "answer_question")
 *
 * Drafts an answer to a single job-application question, grounded ONLY in the
 * user's resume dump (and optional standing profile). Never fabricates: when
 * the resume gives no basis, returns noBasis=true with an empty answer for the
 * user to fill in. When options[] is supplied (a dropdown), the answer must be
 * exactly one of them.
 *
 * Error policy:
 *   - Validation failures → ok:false, type:"validation", retryable:false
 *   - Claude transport errors → ok:false, retryable per ClaudeApiError.retryable
 *   - Malformed JSON in Claude response → ok:false, type:"server", retryable:true
 */

import type { Deps } from '../Code.js';
import type {
  AnswerQuestionRequest,
  AnswerQuestionResult,
  ApiResult,
  ApiErrorResponse,
} from '../types/api-contract.js';
import { ClaudeApiError } from '../types/claude-api.js';
import { calculateCost } from '../cost.js';
import { log } from '../lib/structuredLog.js';

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: 'validation', message, retryable: false } };
}

export function validateAnswerQuestion(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw['question'] !== 'string' || raw['question'].length === 0) {
    log('warn', 'answer_question validate fail: question missing/empty');
    return validationError('Missing or invalid required field: question');
  }
  if (typeof raw['resumeDump'] !== 'string') {
    log('warn', 'answer_question validate fail: resumeDump missing');
    return validationError('Missing or invalid required field: resumeDump');
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    log('warn', 'answer_question validate fail: model missing/empty');
    return validationError('Missing or invalid required field: model');
  }
  if (raw['options'] !== undefined && !Array.isArray(raw['options'])) {
    log('warn', 'answer_question validate fail: options not array');
    return validationError('options must be an array of strings');
  }
  return null;
}

function buildSystemPrompt(): string {
  return [
    'You help a job applicant answer a single application question.',
    'Use ONLY the facts in the provided resume dump and profile. Do NOT invent',
    "experience, employers, dates, or metrics. Write in the applicant's first person.",
    '',
    'If the resume gives no basis to answer truthfully, set "noBasis" to true and',
    'leave "answer" empty — never fabricate.',
    'If a list of allowed options is given, "answer" MUST be exactly one of them.',
    'Keep answers concise: one or two sentences unless the question demands more.',
    '',
    'Return ONLY valid JSON, no preamble, with this exact shape:',
    '{ "answer": "<text>", "noBasis": <true|false> }',
  ].join('\n');
}

function buildUserMessage(req: AnswerQuestionRequest): string {
  const sections: string[] = [];
  sections.push(`=== Question ===\n${req.question}`);
  if (req.fieldType) sections.push(`=== Field type ===\n${req.fieldType}`);
  if (req.options && req.options.length > 0) {
    sections.push(`=== Allowed options (pick exactly one) ===\n${req.options.join('\n')}`);
  }
  if (req.profile && Object.keys(req.profile).length > 0) {
    sections.push(`=== Profile ===\n${JSON.stringify(req.profile, null, 2)}`);
  }
  sections.push(`=== Resume dump ===\n${req.resumeDump || '(empty)'}`);
  sections.push('Return the JSON answer now.');
  return sections.join('\n\n');
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence && fence[1] ? fence[1].trim() : trimmed;
}

export function handleAnswerQuestion(
  deps: Deps,
  req: AnswerQuestionRequest,
): ApiResult<AnswerQuestionResult> {
  log('info', 'answer_question start', { model: req.model });

  let claudeResponse;
  try {
    claudeResponse = deps.claude.call({
      model: req.model,
      maxTokens: 1024,
      system: [{ type: 'text', text: buildSystemPrompt() }],
      messages: [{ role: 'user', content: buildUserMessage(req) }],
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log('error', 'answer_question Claude API error', {
        errorType: err.errorType,
        status: err.statusCode,
        retryable: err.retryable,
        error: err.message,
      });
      return {
        ok: false,
        error: { type: err.errorType, message: err.message, retryable: err.retryable },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'answer_question unexpected Claude failure', { error: msg });
    return { ok: false, error: { type: 'server', message: msg, retryable: true } };
  }

  let answer: string;
  let noBasis: boolean;
  try {
    const parsed = JSON.parse(extractJson(claudeResponse.text)) as {
      answer?: unknown;
      noBasis?: unknown;
    };
    if (typeof parsed.answer !== 'string') throw new Error('answer must be a string');
    answer = parsed.answer;
    noBasis = parsed.noBasis === true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'answer_question parse failure', {
      error: msg,
      snippet: claudeResponse.text.slice(0, 200),
    });
    return {
      ok: false,
      error: { type: 'server', message: `Answer was not valid JSON: ${msg}`, retryable: true },
    };
  }

  const cost = calculateCost(claudeResponse.usage, req.model);
  log('info', 'answer_question done', { noBasis, costUsd: cost.totalUsd });
  return { ok: true, answer, noBasis, cost };
}
