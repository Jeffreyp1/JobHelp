import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ok, err, type Result } from '../types/result.js';

export interface ApplyError {
  readonly type: 'write_error';
  readonly message: string;
  readonly path: string;
}

export interface ApplyOptions {
  readonly answers: Record<string, unknown>;
  readonly outputPath?: string;
}

export interface ApplyResult {
  readonly path: string;
}

export const DEFAULT_RULES_MODE = 'additive' as const;
export const DEFAULT_USER_RULES_DIR_HOME_RELATIVE = 'jobhelp/rules' as const;

type RulesMode = 'defaults_only' | 'additive' | 'replace';

interface SourcesBlock {
  adzuna?: {
    appId: string;
    appKey: string;
    country: string;
  };
  greenhouse?: { tokens: string[] };
  lever?: { slugs: string[] };
}

function defaultConfigPath(): string {
  return join(homedir(), '.config', 'jobhelp', 'config.json');
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function buildConfig(answers: Record<string, unknown>): Record<string, unknown> {
  const sources: SourcesBlock = {};

  const adzunaAppId = answers['sources.adzuna.appId'];
  const adzunaAppKey = answers['sources.adzuna.appKey'];
  const adzunaCountry = answers['sources.adzuna.country'];
  if (
    typeof adzunaAppId === 'string' && adzunaAppId.length > 0 &&
    typeof adzunaAppKey === 'string' && adzunaAppKey.length > 0 &&
    typeof adzunaCountry === 'string' && adzunaCountry.length > 0
  ) {
    sources.adzuna = { appId: adzunaAppId, appKey: adzunaAppKey, country: adzunaCountry };
  }

  const ghTokens = answers['sources.greenhouse.tokens'];
  if (isStringArray(ghTokens) && ghTokens.length > 0) {
    sources.greenhouse = { tokens: ghTokens };
  }

  const leverSlugs = answers['sources.lever.slugs'];
  if (isStringArray(leverSlugs) && leverSlugs.length > 0) {
    sources.lever = { slugs: leverSlugs };
  }

  const rulesMode = answers['rules.mode'] ?? DEFAULT_RULES_MODE;
  const rulesUserDir = answers['rules.userRulesDir'] ?? `~/${DEFAULT_USER_RULES_DIR_HOME_RELATIVE}`;

  return {
    profile: {
      location: answers['profile.location'],
      skills: answers['profile.skills'],
      salaryFloor: answers['profile.salaryFloor'],
      seniority: answers['profile.seniority'],
      roleFamily: answers['profile.roleFamily'],
      resumeDumpPath: answers['profile.resumeDumpPath'],
      remoteOk: answers['profile.remoteOk'],
    },
    sources,
    ranking: {
      useLlmFitScore: false,
      topN: 20,
      digestK: 10,
    },
    output: {
      dir: answers['output.dir'] ?? '~/jobhelp/digests',
    },
    rules: {
      mode: rulesMode as RulesMode,
      userRulesDir: rulesUserDir,
    },
  };
}

export async function applyConfigAnswers(
  options: ApplyOptions,
): Promise<Result<ApplyResult, ApplyError>> {
  const outputPath = options.outputPath ?? defaultConfigPath();
  const config = buildConfig(options.answers);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return ok({ path: outputPath });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown write error';
    return err({ type: 'write_error', message, path: outputPath });
  }
}
