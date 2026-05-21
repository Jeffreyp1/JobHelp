import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AdzunaConfig,
  AshbyConfig,
  BreezyConfig,
  GreenhouseConfig,
  JobDigestConfig,
  JSearchConfig,
  LeverConfig,
  OutputConfig,
  PersonioConfig,
  PinpointConfig,
  ProfileConfig,
  RankingConfig,
  RecruiteeConfig,
  RemoteOkConfig,
  RemotiveConfig,
  RulesConfig,
  RulesMode,
  Seniority,
  SmartRecruitersConfig,
  SourcesConfig,
  TeamtailorConfig,
  UsaJobsConfig,
  WeWorkRemotelyConfig,
  WorkableConfig,
  YcStartupConfig,
} from '../types/config.js';
import {
  validateBM25,
  validateFusion,
  validateMaxAge,
  validateRecency,
  validateSourceTrust,
} from './config-ranking.js';
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
    return {
      topN: 20,
      digestK: 10,
      bm25: validateBM25(undefined),
      recency: validateRecency(undefined),
      maxAge: validateMaxAge(undefined),
      sourceTrust: validateSourceTrust(undefined),
      fusion: validateFusion(undefined),
    };
  }
  const obj = requireRecord(raw, 'ranking');
  return {
    topN: obj['topN'] !== undefined ? requireNumber(obj['topN'], 'ranking.topN') : 20,
    digestK: obj['digestK'] !== undefined ? requireNumber(obj['digestK'], 'ranking.digestK') : 10,
    bm25: validateBM25(obj['bm25']),
    recency: validateRecency(obj['recency']),
    maxAge: validateMaxAge(obj['maxAge']),
    sourceTrust: validateSourceTrust(obj['sourceTrust']),
    fusion: validateFusion(obj['fusion']),
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
  const out: { apiKey: string; email: string; queries?: string[] } = {
    apiKey: requireString(obj['apiKey'], 'sources.usajobs.apiKey'),
    email: requireString(obj['email'], 'sources.usajobs.email'),
  };
  if (obj['queries'] !== undefined) {
    out.queries = requireStringArray(obj['queries'], 'sources.usajobs.queries');
  }
  return out;
}

function validateJSearch(raw: unknown): JSearchConfig {
  const obj = requireRecord(raw, 'sources.jsearch');
  const out: { rapidApiKey: string; queries?: string[] } = {
    rapidApiKey: requireString(obj['rapidApiKey'], 'sources.jsearch.rapidApiKey'),
  };
  if (obj['queries'] !== undefined) {
    out.queries = requireStringArray(obj['queries'], 'sources.jsearch.queries');
  }
  return out;
}

function validateYc(raw: unknown): YcStartupConfig {
  const obj = requireRecord(raw, 'sources.yc');
  const out: { queries?: string[] } = {};
  if (obj['queries'] !== undefined) {
    out.queries = requireStringArray(obj['queries'], 'sources.yc.queries');
  }
  return out;
}

function validateWeWorkRemotely(raw: unknown): WeWorkRemotelyConfig {
  const obj = requireRecord(raw, 'sources.weworkremotely');
  const out: { categories?: string[] } = {};
  if (obj['categories'] !== undefined) {
    out.categories = requireStringArray(obj['categories'], 'sources.weworkremotely.categories');
  }
  return out;
}

function validateAshby(raw: unknown): AshbyConfig {
  const obj = requireRecord(raw, 'sources.ashby');
  return { tokens: requireStringArray(obj['tokens'], 'sources.ashby.tokens') };
}

function validateBreezy(raw: unknown): BreezyConfig {
  const obj = requireRecord(raw, 'sources.breezy');
  return { tokens: requireStringArray(obj['tokens'], 'sources.breezy.tokens') };
}

function validatePersonio(raw: unknown): PersonioConfig {
  const obj = requireRecord(raw, 'sources.personio');
  return { tokens: requireStringArray(obj['tokens'], 'sources.personio.tokens') };
}

function validatePinpoint(raw: unknown): PinpointConfig {
  const obj = requireRecord(raw, 'sources.pinpoint');
  return { tokens: requireStringArray(obj['tokens'], 'sources.pinpoint.tokens') };
}

function validateRecruitee(raw: unknown): RecruiteeConfig {
  const obj = requireRecord(raw, 'sources.recruitee');
  return { tokens: requireStringArray(obj['tokens'], 'sources.recruitee.tokens') };
}

function validateRemoteOk(raw: unknown): RemoteOkConfig {
  requireRecord(raw, 'sources.remoteok');
  return {};
}

function validateRemotive(raw: unknown): RemotiveConfig {
  const obj = requireRecord(raw, 'sources.remotive');
  const out: { queries?: readonly string[]; limit?: number } = {};
  if (obj['queries'] !== undefined) {
    out.queries = requireStringArray(obj['queries'], 'sources.remotive.queries');
  }
  if (obj['limit'] !== undefined) {
    out.limit = requireNumber(obj['limit'], 'sources.remotive.limit');
  }
  return out;
}

function validateSmartRecruiters(raw: unknown): SmartRecruitersConfig {
  const obj = requireRecord(raw, 'sources.smartrecruiters');
  return { tokens: requireStringArray(obj['tokens'], 'sources.smartrecruiters.tokens') };
}

function validateTeamtailor(raw: unknown): TeamtailorConfig {
  const obj = requireRecord(raw, 'sources.teamtailor');
  return { tokens: requireStringArray(obj['tokens'], 'sources.teamtailor.tokens') };
}

function validateWorkable(raw: unknown): WorkableConfig {
  const obj = requireRecord(raw, 'sources.workable');
  return { tokens: requireStringArray(obj['tokens'], 'sources.workable.tokens') };
}

function validateSources(raw: unknown): SourcesConfig {
  if (raw === undefined) return {};
  const obj = requireRecord(raw, 'sources');
  const out: {
    adzuna?: AdzunaConfig;
    ashby?: AshbyConfig;
    breezy?: BreezyConfig;
    greenhouse?: GreenhouseConfig;
    jsearch?: JSearchConfig;
    lever?: LeverConfig;
    personio?: PersonioConfig;
    pinpoint?: PinpointConfig;
    recruitee?: RecruiteeConfig;
    remoteok?: RemoteOkConfig;
    remotive?: RemotiveConfig;
    smartrecruiters?: SmartRecruitersConfig;
    teamtailor?: TeamtailorConfig;
    usajobs?: UsaJobsConfig;
    weworkremotely?: WeWorkRemotelyConfig;
    workable?: WorkableConfig;
    yc?: YcStartupConfig;
  } = {};
  if (obj['adzuna'] !== undefined) out.adzuna = validateAdzuna(obj['adzuna']);
  if (obj['ashby'] !== undefined) out.ashby = validateAshby(obj['ashby']);
  if (obj['breezy'] !== undefined) out.breezy = validateBreezy(obj['breezy']);
  if (obj['greenhouse'] !== undefined) out.greenhouse = validateGreenhouse(obj['greenhouse']);
  if (obj['jsearch'] !== undefined) out.jsearch = validateJSearch(obj['jsearch']);
  if (obj['lever'] !== undefined) out.lever = validateLever(obj['lever']);
  if (obj['personio'] !== undefined) out.personio = validatePersonio(obj['personio']);
  if (obj['pinpoint'] !== undefined) out.pinpoint = validatePinpoint(obj['pinpoint']);
  if (obj['recruitee'] !== undefined) out.recruitee = validateRecruitee(obj['recruitee']);
  if (obj['remoteok'] !== undefined) out.remoteok = validateRemoteOk(obj['remoteok']);
  if (obj['remotive'] !== undefined) out.remotive = validateRemotive(obj['remotive']);
  if (obj['smartrecruiters'] !== undefined) out.smartrecruiters = validateSmartRecruiters(obj['smartrecruiters']);
  if (obj['teamtailor'] !== undefined) out.teamtailor = validateTeamtailor(obj['teamtailor']);
  if (obj['usajobs'] !== undefined) out.usajobs = validateUsaJobs(obj['usajobs']);
  if (obj['weworkremotely'] !== undefined) out.weworkremotely = validateWeWorkRemotely(obj['weworkremotely']);
  if (obj['workable'] !== undefined) out.workable = validateWorkable(obj['workable']);
  if (obj['yc'] !== undefined) out.yc = validateYc(obj['yc']);
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
