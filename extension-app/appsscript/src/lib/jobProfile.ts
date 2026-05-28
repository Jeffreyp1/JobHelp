/**
 * Profile distillation: source materials -> JobProfile via a Claude call.
 */

import type { JobProfile } from '../types/job-discovery.js';
import type { ClaudeClient } from '../types/claude-api.js';
import { ClaudeApiError } from '../types/claude-api.js';
import type { CostBreakdown } from '../types/api-contract.js';
import { calculateCost } from '../cost.js';
import { log } from './structuredLog.js';

const SYSTEM_PROMPT =
  "You distil a candidate's career materials into a structured job-search profile.";

const SENIORITIES = ['junior', 'mid', 'senior', 'staff', 'principal', 'unspecified'] as const;
type Seniority = (typeof SENIORITIES)[number];

const REMOTE_VALUES = ['required', 'preferred', 'no', 'any'] as const;
type Remote = (typeof REMOTE_VALUES)[number];

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function asSeniority(v: unknown): Seniority {
  return typeof v === 'string' && (SENIORITIES as readonly string[]).includes(v)
    ? (v as Seniority)
    : 'unspecified';
}

function asRemote(v: unknown): Remote {
  return typeof v === 'string' && (REMOTE_VALUES as readonly string[]).includes(v)
    ? (v as Remote)
    : 'any';
}

function asFilters(v: unknown): JobProfile['filters'] {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    remote: asRemote(o['remote']),
    minSalary: typeof o['minSalary'] === 'number' && isFinite(o['minSalary']) ? o['minSalary'] : null,
    locations: asStringArray(o['locations']),
  };
}

/**
 * Distil the user's source-materials text into a JobProfile (titles, skills,
 * domains, search queries, filters, a ~200-word summary) using one Claude call.
 *
 * Throws on malformed JSON. Rethrows ClaudeApiError unchanged (caller maps it).
 */
export function distilProfile(
  claude: ClaudeClient,
  model: string,
  sourceMaterialsText: string,
): { profile: JobProfile; cost: CostBreakdown } {
  log('info', 'distilProfile start', { model });

  const userMessage = [
    "Here are the candidate's career source materials (resume, projects, notes):",
    '',
    sourceMaterialsText,
    '',
    'Return ONLY a JSON object (no preamble, no markdown fences) matching exactly this shape:',
    '{',
    '  "titles": string[],                  // role titles to search for',
    '  "seniority": "junior"|"mid"|"senior"|"staff"|"principal"|"unspecified",',
    '  "skills": string[],                  // canonical, deduped, ~15-40 items',
    '  "domains": string[],                 // industries / domains the candidate fits',
    '  "searchQueries": string[],           // ~3-6 realistic job-board queries, e.g. "senior backend engineer"',
    '  "filters": { "remote": "required"|"preferred"|"no"|"any", "minSalary": number|null, "locations": string[] },',
    '  "summary": string                    // ~150-250 words, third person, what the candidate is strong at',
    '}',
  ].join('\n');

  let response;
  try {
    response = claude.call({
      model,
      maxTokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log('error', 'distilProfile Claude API error', {
        errorType: err.errorType,
        status: err.statusCode,
        retryable: err.retryable,
        error: err.message,
      });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'distilProfile Claude call failed', { error: message });
    throw err instanceof Error ? err : new Error(message);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFences(response.text)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'distilProfile invalid JSON from Claude', {
      error: message,
      textSnippet: response.text.slice(0, 200),
    });
    throw new Error(`distilProfile: Claude returned invalid JSON: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log('error', 'distilProfile: Claude JSON was not an object');
    throw new Error('distilProfile: Claude returned a non-object JSON value');
  }

  const titles = asStringArray(parsed['titles']);
  let searchQueries = asStringArray(parsed['searchQueries']);
  if (searchQueries.length === 0) searchQueries = titles.slice(0, 3);

  const profile: JobProfile = {
    titles,
    seniority: asSeniority(parsed['seniority']),
    skills: asStringArray(parsed['skills']),
    domains: asStringArray(parsed['domains']),
    searchQueries,
    filters: asFilters(parsed['filters']),
    summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : '',
  };

  const cost = calculateCost(response.usage, response.model);

  log('info', 'distilProfile done', {
    model: response.model,
    skillCount: profile.skills.length,
    queryCount: profile.searchQueries.length,
  });

  return { profile, cost };
}
