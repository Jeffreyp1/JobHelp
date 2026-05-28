import type {
  AdzunaConfig,
  AshbyConfig,
  BreezyConfig,
  GreenhouseConfig,
  JSearchConfig,
  LeverConfig,
  PersonioConfig,
  PinpointConfig,
  RecruiteeConfig,
  RemoteOkConfig,
  RemotiveConfig,
  SmartRecruitersConfig,
  SourcesConfig,
  TeamtailorConfig,
  UsaJobsConfig,
  WeWorkRemotelyConfig,
  WorkableConfig,
  YcStartupConfig,
} from '../types/config.js';
import {
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './config-validation-primitives.js';

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

export function validateSources(raw: unknown): SourcesConfig {
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
