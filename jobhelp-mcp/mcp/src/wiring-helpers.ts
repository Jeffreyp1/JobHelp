import { homedir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from '../../core/types/result.js';
import {
  loadDefaults,
  loadUserRules,
  type LoaderError,
} from '../../core/rules/loader.js';
import { merge, type RuleFile as RuleFileShape } from '../../core/rules/merger.js';
import type { JobDigestConfig } from '../../core/types/config.js';
import type { NormalizedJob } from '../../core/types/job.js';
import { ALL_ADAPTERS } from '../../core/sources/index.js';
import { SourceFetchError } from '../../core/sources/_shared.js';
import { resolveHttpOptions } from '../../core/digest/generate.js';
import type { ReadRulesResult, ToolError, RulesMode as ToolRulesMode } from './tools-types.js';
import type { ResourceError, RuleFileContent } from './resources.js';

export function getConfigPath(): string {
  const override = process.env['JOBHELP_CONFIG_PATH'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.config', 'jobhelp', 'config.json');
}

export function getResumesDir(): string {
  const root = process.env['JOBHELP_HOME'];
  const base = root !== undefined && root.length > 0 ? root : join(homedir(), 'jobhelp');
  return join(base, 'resumes');
}

const TOOL_ERROR_TYPE_MAP: Readonly<Record<string, ToolError['type']>> = {
  not_found: 'not_found',
  invalid_name: 'invalid_input',
  invalid_content: 'invalid_input',
  invalid_input: 'invalid_input',
  no_active: 'not_configured',
  io: 'io_error',
  io_error: 'io_error',
  state_error: 'io_error',
  validation: 'invalid_input',
  parse: 'invalid_input',
  write_error: 'io_error',
};

const RESOURCE_ERROR_TYPE_MAP: Readonly<Record<string, ResourceError['type']>> = {
  not_found: 'not_found',
  io: 'io_error',
  io_error: 'io_error',
  state_error: 'io_error',
  no_active: 'not_configured',
  validation: 'internal',
  parse: 'internal',
};

export function toToolError(
  e: { readonly type: string; readonly message: string },
  fallback: ToolError['type'] = 'internal',
): ToolError {
  return { type: TOOL_ERROR_TYPE_MAP[e.type] ?? fallback, message: e.message };
}

export function toResourceError(
  e: { readonly type: string; readonly message: string },
  fallback: ResourceError['type'] = 'internal',
): ResourceError {
  return { type: RESOURCE_ERROR_TYPE_MAP[e.type] ?? fallback, message: e.message };
}

export async function loadRulesByMode(
  mode: ToolRulesMode,
  userRulesDir: string,
  configMergeMode: 'defaults_only' | 'additive' | 'replace',
): Promise<Result<readonly RuleFileShape[], LoaderError>> {
  if (mode === 'defaults') return loadDefaults();
  if (mode === 'user') return loadUserRules(userRulesDir);
  const defaults = await loadDefaults();
  if (!defaults.ok) return defaults;
  const user = await loadUserRules(userRulesDir);
  if (!user.ok) return user;
  return ok(merge(defaults.value, user.value, configMergeMode));
}

export function rulesToRuleFileContent(
  rules: readonly RuleFileShape[],
): readonly RuleFileContent[] {
  return rules.map((r) => ({ name: r.filename, content: r.content }));
}

export function rulesToReadRulesResult(
  mode: ToolRulesMode,
  rules: readonly RuleFileShape[],
): ReadRulesResult {
  return {
    mode,
    files: rules.map((r) => ({ name: r.filename, content: r.content })),
  };
}

const SKILLS_SECTION_RE = /(?:^|\n)#{1,6}\s*(?:technical\s+)?skills\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|\n\s*$|$)/i;
const TOKEN_RE = /[A-Za-z][A-Za-z0-9+#.\-]*/g;
const STOPWORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by',
  'as', 'is', 'are', 'be', 'was', 'were', 'i', 'we', 'you', 'they', 'it',
]);

export function extractSkillsFromMarkdown(markdown: string): readonly string[] {
  const match = SKILLS_SECTION_RE.exec(markdown);
  const target = match !== null && match[1] !== undefined ? match[1] : markdown;
  const tokens = target.match(TOKEN_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 2) continue;
    const lc = t.toLowerCase();
    if (STOPWORDS.has(lc)) continue;
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(t);
  }
  return out;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scoreOverlap(
  jobText: string,
  skills: readonly string[],
): { score: number; matched: readonly string[]; missing: readonly string[] } {
  if (skills.length === 0) return { score: 0, matched: [], missing: [] };
  const haystack = jobText.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim();
    if (trimmed.length === 0) continue;
    const re = new RegExp('\\b' + escapeRegExp(trimmed.toLowerCase()) + '\\b');
    if (re.test(haystack)) matched.push(trimmed);
    else missing.push(trimmed);
  }
  const denom = matched.length + missing.length;
  const score = denom === 0 ? 0 : matched.length / denom;
  return { score, matched, missing };
}

export function todayIsoDate(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface AdapterOutcome {
  readonly source: string;
  readonly jobs: readonly NormalizedJob[];
  readonly error?: { readonly type: string; readonly message: string };
}

export async function runAdapterIsolated(
  adapter: (typeof ALL_ADAPTERS)[number],
  config: JobDigestConfig,
): Promise<AdapterOutcome> {
  if (!adapter.enabled(config)) {
    return {
      source: adapter.name,
      jobs: [],
      error: { type: 'auth', message: 'adapter not configured' },
    };
  }
  try {
    const jobs = await adapter.fetch(config, { http: resolveHttpOptions() });
    return { source: adapter.name, jobs };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const type = e instanceof SourceFetchError ? e.type : 'network';
    return { source: adapter.name, jobs: [], error: { type, message } };
  }
}

export function notConfiguredTool(): ToolError {
  return {
    type: 'not_configured',
    message: 'jobhelp config not found. Run init_config to set up.',
  };
}

export function notConfiguredResource(): ResourceError {
  return {
    type: 'not_configured',
    message: 'jobhelp config not found. Run init_config to set up.',
  };
}

export { err, ok };
