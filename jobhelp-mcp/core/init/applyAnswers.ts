import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ok, err, type Result } from '../types/result.js';
import { expandHome } from '../lib/config-path.js';
import { writeDefaultCompanySourcesIfMissing } from './companySources.js';

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
  readonly companySourcesPath: string;
  readonly companySourcesCreated: boolean;
}

export const DEFAULT_RULES_MODE = 'additive' as const;
export const DEFAULT_USER_RULES_DIR_HOME_RELATIVE = 'jobhelp/rules' as const;
export const DEFAULT_ADZUNA_QUERIES: readonly string[] = [] as const;

type RulesMode = 'defaults_only' | 'additive' | 'replace';

interface SourcesBlock {
  adzuna?: {
    appId: string;
    appKey: string;
    country: string;
    queries: string[];
  };
  greenhouse?: { tokens: string[] };
  lever?: { slugs: string[] };
}

function defaultConfigPath(): string {
  const override = process.env['JOBHELP_CONFIG_PATH'];
  if (override) return expandHome(override);
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
  const adzunaQueries = answers['sources.adzuna.queries'];
  if (
    typeof adzunaAppId === 'string' && adzunaAppId.length > 0 &&
    typeof adzunaAppKey === 'string' && adzunaAppKey.length > 0 &&
    typeof adzunaCountry === 'string' && adzunaCountry.length > 0
  ) {
    sources.adzuna = {
      appId: adzunaAppId,
      appKey: adzunaAppKey,
      country: adzunaCountry,
      queries: adzunaSearchQueries(answers),
    };
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

function adzunaSearchQueries(answers: Record<string, unknown>): string[] {
  const adzunaQueries = answers['sources.adzuna.queries'];
  if (isStringArray(adzunaQueries) && adzunaQueries.length > 0) return adzunaQueries;
  const roleFamily = answers['profile.roleFamily'];
  if (isStringArray(roleFamily) && roleFamily.length > 0) return roleFamily;
  const skills = answers['profile.skills'];
  if (isStringArray(skills) && skills.length > 0) return skills.slice(0, 5);
  return [...DEFAULT_ADZUNA_QUERIES];
}

export async function applyConfigAnswers(
  options: ApplyOptions,
): Promise<Result<ApplyResult, ApplyError>> {
  const outputPath = options.outputPath ?? defaultConfigPath();
  const config = buildConfig(options.answers);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    const companySources = await writeDefaultCompanySourcesIfMissing(outputPath);
    return ok({
      path: outputPath,
      companySourcesPath: companySources.path,
      companySourcesCreated: companySources.created,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown write error';
    return err({ type: 'write_error', message, path: outputPath });
  }
}
