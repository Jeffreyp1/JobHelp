import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CoreDeps, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import { parseDoctor, parseRerankTopJobs, parseValidateSources } from './tools-parsers.js';
import { ALL_ADAPTERS, ALL_SOURCE_NAMES } from '../../core/sources/index.js';
import { loadConfig } from '../../core/lib/config.js';
import { readState } from '../../core/state/store.js';
import { getLatestDigest } from '../../core/state/digestStore.js';
import { loadDefaults } from '../../core/rules/loader.js';
import { getApplicationsRoot } from '../../core/applications/paths.js';
import { getConfigPath } from './wiring-helpers.js';
import { ok, type Result } from '../../core/types/result.js';
import type {
  DoctorCheck,
  DoctorResult,
  ToolError,
  ValidateSourcesResult,
} from './tools-types.js';

const ZERO_SOURCES_NEXT_STEP =
  'Add at least one source under sources in your jobhelp config, then rerun validate_sources.';
const ALL_SOURCES_FAILED_NEXT_STEP =
  'Run doctor, then inspect each failed source error for stale credentials, bad board tokens, or network/rate-limit failures.';

function withValidationGuidance(result: ValidateSourcesResult): ValidateSourcesResult {
  if (result.summary.total === 0) {
    return {
      ...result,
      summary: {
        ...result.summary,
        nextStep: 'Add at least one source before running a digest.',
      },
      nextSteps: [ZERO_SOURCES_NEXT_STEP],
    };
  }
  if (result.summary.ok === 0 && result.summary.failed === result.summary.total) {
    return {
      ...result,
      summary: {
        ...result.summary,
        nextStep: 'Every configured source failed; fix source setup before a long run.',
      },
      nextSteps: [ALL_SOURCES_FAILED_NEXT_STEP],
    };
  }
  return result;
}

function messageFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function writableStatus(path: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return { ok: false, detail: 'path exists but is not a directory' };
    await access(path, constants.W_OK);
    return { ok: true, detail: 'directory exists and is writable' };
  } catch (e: unknown) {
    const code = typeof e === 'object' && e !== null ? Reflect.get(e, 'code') : undefined;
    if (code !== 'ENOENT') return { ok: false, detail: messageFromUnknown(e) };
  }
  try {
    await access(dirname(path), constants.W_OK);
    return { ok: true, detail: 'directory is missing; parent is writable' };
  } catch (e: unknown) {
    return { ok: false, detail: `directory is missing and parent is not writable: ${messageFromUnknown(e)}` };
  }
}

function nextSteps(checks: readonly DoctorCheck[]): readonly string[] {
  return checks.flatMap((c) => (c.ok || c.nextStep === undefined ? [] : [c.nextStep]));
}

async function runDoctor(): Promise<Result<DoctorResult, ToolError>> {
  const checks: DoctorCheck[] = [];
  const configPath = getConfigPath();
  const readable = await canRead(configPath);
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) {
    checks.push({
      name: 'config',
      ok: false,
      path: loaded.error.path ?? configPath,
      detail: loaded.error.message,
      nextStep: 'Run init_config or set JOBHELP_CONFIG_PATH to a readable config file.',
    });
    return ok({ ready: false, checks, nextSteps: nextSteps(checks) });
  }
  checks.push({
    name: 'config',
    ok: readable,
    path: configPath,
    detail: readable ? 'config is readable' : 'config loaded but is not readable via filesystem access',
    ...(readable ? {} : { nextStep: 'Fix config file permissions, then rerun doctor.' }),
  });

  const config = loaded.value;
  const enabledSources = ALL_ADAPTERS.filter((a) => a.enabled(config)).map((a) => a.name);
  checks.push({
    name: 'sources',
    ok: enabledSources.length > 0,
    detail:
      enabledSources.length > 0
        ? `enabled sources: ${enabledSources.join(', ')}`
        : 'no enabled sources found',
    ...(enabledSources.length > 0 ? {} : { nextStep: ZERO_SOURCES_NEXT_STEP }),
  });

  const stateRead = await readState();
  if (!stateRead.ok) {
    checks.push({
      name: 'active_resume',
      ok: false,
      detail: stateRead.error.message,
      nextStep: 'Register a resume with register_resume, then rerun doctor.',
    });
  } else {
    const active = stateRead.value.activeResumeName;
    checks.push({
      name: 'active_resume',
      ok: active !== undefined,
      detail: active !== undefined ? `active resume: ${active}` : 'no active resume set',
      ...(active !== undefined
        ? {}
        : { nextStep: 'Register a resume with register_resume, then rerun doctor.' }),
    });
  }

  const digest = await getLatestDigest();
  checks.push({
    name: 'latest_digest',
    ok: digest.ok,
    detail: digest.ok ? `latest digest generated at ${digest.value.generatedAt}` : digest.error.message,
    ...(digest.ok ? {} : { nextStep: 'Run find_matching_jobs after sources and resume are ready.' }),
  });

  const defaults = await loadDefaults();
  const userRulesReadable = await canRead(config.rules.userRulesDir);
  checks.push({
    name: 'rules',
    ok: defaults.ok && userRulesReadable,
    path: config.rules.userRulesDir,
    detail: defaults.ok
      ? userRulesReadable
        ? 'bundled and user rules are readable'
        : 'bundled rules loaded; user rules dir is not readable'
      : defaults.error.message,
    ...(defaults.ok && userRulesReadable
      ? {}
      : { nextStep: 'Ensure rules.userRulesDir exists and is readable, or use defaults_only mode.' }),
  });

  const output = await writableStatus(config.output.dir);
  checks.push({
    name: 'output_dir',
    ok: output.ok,
    path: config.output.dir,
    detail: output.detail,
    ...(output.ok ? {} : { nextStep: 'Make output.dir writable before running a digest.' }),
  });

  const applicationsPath = getApplicationsRoot();
  const applications = await writableStatus(applicationsPath);
  checks.push({
    name: 'applications_dir',
    ok: applications.ok,
    path: applicationsPath,
    detail: applications.detail,
    ...(applications.ok ? {} : { nextStep: 'Make the JOBHELP_HOME applications path writable.' }),
  });

  return ok({ ready: checks.every((c) => c.ok), checks, nextSteps: nextSteps(checks) });
}

export function createMetaTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'doctor',
      description:
        'Read-only setup diagnostics for MCP readiness: config readability, enabled sources, active resume, latest digest, rules, output path, and application path. Use before long runs to get actionable next steps.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      parse: parseDoctor,
      run: async () => unwrap(await runDoctor()),
    }),
    buildHandler({
      name: 'validate_sources',
      description:
        'Ping each configured source adapter (every source in the adapter registry) and report per-source health: ok/failed, statusCode, jobCount, durationMs. Use this at config time to catch stale tokens, expired credentials, or rate limits before they silently produce empty digests.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: [...ALL_SOURCE_NAMES],
            description: 'Optional adapter name to validate only that source. Omit to validate all configured adapters.',
          },
        },
        additionalProperties: false,
      },
      parse: parseValidateSources,
      run: async (args) => {
        const result = await deps.validateSources(args);
        if (!result.ok) return unwrap(result);
        return unwrap(ok(withValidationGuidance(result.value)));
      },
    }),
    buildHandler({
      name: 'rerank_top_jobs',
      description:
        'Bundle the top-K ranked jobs from the latest digest with the active resume and a structured rerank prompt for the client AI to apply semantic judgment in its own session. The server makes NO LLM calls; the client consumes the bundle and produces a curated tier-ranked list. Default topK=30, max 50.',
      inputSchema: {
        type: 'object',
        properties: {
          topK: {
            type: 'number',
            description: 'How many top-ranked jobs to bundle. Default 30, max 50.',
          },
          instructions: {
            type: 'string',
            description: 'Free-text user emphasis (e.g., "focus on Go backend", "AI startups only"). Max 1000 chars.',
          },
        },
        additionalProperties: false,
      },
      parse: parseRerankTopJobs,
      run: async (args) => unwrap(await deps.rerankTopJobs(args)),
    }),
  ];
}
