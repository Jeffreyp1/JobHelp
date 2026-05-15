import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AdzunaConfig,
  GreenhouseConfig,
  JobDigestConfig,
  JSearchConfig,
  LeverConfig,
  OutputConfig,
  ProfileConfig,
  RankingConfig,
  RulesConfig,
  RulesMode,
  Seniority,
  SourcesConfig,
  UsaJobsConfig,
} from '../types/config.js';
import { err, ok, type Result } from '../types/result.js';

export type { RulesMode, RulesConfig };

export interface ConfigError {
  readonly type: 'not_found' | 'parse' | 'validation';
  readonly message: string;
  readonly path?: string;
}

const SENIORITY_VALUES: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];

const ENV_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/gi;

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function interpolateEnvString(s: string): string {
  return s.replace(ENV_RE, (_match, name: string) => process.env[name] ?? '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') return interpolateEnvString(value);
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return value;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function requireRecord(v: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`expected object at field ${field}`);
  return v;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') fail(`expected string at field ${field}`);
  return v;
}

function requireNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) fail(`expected number at field ${field}`);
  return v;
}


function requireBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') fail(`expected boolean at field ${field}`);
  return v;
}

function requireStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) fail(`expected string[] at field ${field}`);
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (typeof item !== 'string') fail(`expected string at field ${field}[${i}]`);
    out.push(item);
  }
  return out;
}

function isSeniority(v: unknown): v is Seniority {
  if (typeof v !== 'string') return false;
  for (const s of SENIORITY_VALUES) {
    if (s === v) return true;
  }
  return false;
}

function validateProfile(raw: unknown): ProfileConfig {
  const obj = requireRecord(raw, 'profile');
  const seniority = obj['seniority'];
  if (!isSeniority(seniority)) {
    fail(`expected one of ${SENIORITY_VALUES.join(',')} at field profile.seniority`);
  }
  return {
    resumeDumpPath: expandHome(requireString(obj['resumeDumpPath'], 'profile.resumeDumpPath')),
    skills: requireStringArray(obj['skills'], 'profile.skills'),
    location: requireString(obj['location'], 'profile.location'),
    remoteOk: requireBoolean(obj['remoteOk'], 'profile.remoteOk'),
    salaryFloor: requireNumber(obj['salaryFloor'], 'profile.salaryFloor'),
    seniority,
    roleFamily: requireStringArray(obj['roleFamily'], 'profile.roleFamily'),
  };
}

function validateRanking(raw: unknown): RankingConfig {
  if (raw === undefined) {
    return { useLlmFitScore: false, topN: 20, digestK: 10 };
  }
  const obj = requireRecord(raw, 'ranking');
  return {
    useLlmFitScore: false,
    topN: obj['topN'] !== undefined ? requireNumber(obj['topN'], 'ranking.topN') : 20,
    digestK: obj['digestK'] !== undefined ? requireNumber(obj['digestK'], 'ranking.digestK') : 10,
  };
}

function validateOutput(raw: unknown): OutputConfig {
  if (raw === undefined) {
    return { dir: expandHome(join('~', 'jobhelp', 'digests')) };
  }
  const obj = requireRecord(raw, 'output');
  return { dir: expandHome(requireString(obj['dir'], 'output.dir')) };
}

function validateRules(raw: unknown): RulesConfig {
  const defaultUserRulesDir = expandHome(join('~', 'jobhelp', 'rules'));
  if (raw === undefined) {
    return { userRulesDir: defaultUserRulesDir, mode: 'additive' };
  }
  const obj = requireRecord(raw, 'rules');
  const rawMode = obj['mode'];
  let mode: RulesMode = 'additive';
  if (rawMode !== undefined) {
    if (rawMode !== 'defaults_only' && rawMode !== 'additive' && rawMode !== 'replace') {
      fail(`expected one of defaults_only,additive,replace at field rules.mode`);
    }
    mode = rawMode;
  }
  const rawDir = obj['userRulesDir'];
  const userRulesDir =
    rawDir !== undefined
      ? expandHome(requireString(rawDir, 'rules.userRulesDir'))
      : defaultUserRulesDir;
  return { userRulesDir, mode };
}

function validateAdzuna(raw: unknown): AdzunaConfig {
  const obj = requireRecord(raw, 'sources.adzuna');
  return {
    appId: requireString(obj['appId'], 'sources.adzuna.appId'),
    appKey: requireString(obj['appKey'], 'sources.adzuna.appKey'),
    country: requireString(obj['country'], 'sources.adzuna.country'),
    queries: requireStringArray(obj['queries'], 'sources.adzuna.queries'),
  };
}

function validateGreenhouse(raw: unknown): GreenhouseConfig {
  const obj = requireRecord(raw, 'sources.greenhouse');
  return { tokens: requireStringArray(obj['tokens'], 'sources.greenhouse.tokens') };
}

function validateLever(raw: unknown): LeverConfig {
  const obj = requireRecord(raw, 'sources.lever');
  return { slugs: requireStringArray(obj['slugs'], 'sources.lever.slugs') };
}

function validateUsaJobs(raw: unknown): UsaJobsConfig {
  const obj = requireRecord(raw, 'sources.usajobs');
  return {
    apiKey: requireString(obj['apiKey'], 'sources.usajobs.apiKey'),
    email: requireString(obj['email'], 'sources.usajobs.email'),
  };
}

function validateJSearch(raw: unknown): JSearchConfig {
  const obj = requireRecord(raw, 'sources.jsearch');
  return { rapidApiKey: requireString(obj['rapidApiKey'], 'sources.jsearch.rapidApiKey') };
}

function validateSources(raw: unknown): SourcesConfig {
  if (raw === undefined) return {};
  const obj = requireRecord(raw, 'sources');
  const out: {
    adzuna?: AdzunaConfig;
    greenhouse?: GreenhouseConfig;
    lever?: LeverConfig;
    usajobs?: UsaJobsConfig;
    jsearch?: JSearchConfig;
  } = {};
  if (obj['adzuna'] !== undefined) out.adzuna = validateAdzuna(obj['adzuna']);
  if (obj['greenhouse'] !== undefined) out.greenhouse = validateGreenhouse(obj['greenhouse']);
  if (obj['lever'] !== undefined) out.lever = validateLever(obj['lever']);
  if (obj['usajobs'] !== undefined) out.usajobs = validateUsaJobs(obj['usajobs']);
  if (obj['jsearch'] !== undefined) out.jsearch = validateJSearch(obj['jsearch']);
  return out;
}

function validate(raw: unknown): JobDigestConfig {
  const obj = requireRecord(raw, '<root>');
  return {
    profile: validateProfile(obj['profile']),
    sources: validateSources(obj['sources']),
    ranking: validateRanking(obj['ranking']),
    output: validateOutput(obj['output']),
    rules: validateRules(obj['rules']),
  };
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

export async function loadConfig(
  path: string,
): Promise<Result<JobDigestConfig, ConfigError>> {
  const resolved = expandHome(path);
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return err({
        type: 'not_found',
        path: resolved,
        message: `config file not found: ${resolved}`,
      });
    }
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'not_found', path: resolved, message });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return err({ type: 'parse', path: resolved, message: `failed to parse JSON: ${message}` });
  }

  const interpolated = interpolateEnv(parsed);

  try {
    const config = validate(interpolated);
    return ok(config);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown validation error';
    return err({ type: 'validation', path: resolved, message });
  }
}
