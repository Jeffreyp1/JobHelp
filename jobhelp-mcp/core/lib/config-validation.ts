import { join } from 'node:path';
import type {
  JobDigestConfig,
  OutputConfig,
  ProfileConfig,
  RankingConfig,
  RulesConfig,
  RulesMode,
  SemanticConfig,
  Seniority,
  TriageConfig,
} from '../types/config.js';
import {
  DEFAULT_SEMANTIC_CANDIDATE_LIMIT,
  validateBM25,
  validateFusion,
  validateHistory,
  validateMaxAge,
  validateRecency,
  validateRerank,
  validateSourceTrust,
} from './config-ranking.js';
import { expandHome } from './config-path.js';
import { validateSources } from './config-sources.js';
import {
  detectCountryFromLocation,
  detectRoleFamily,
  type RoleFamily,
} from '../pipeline/classify.js';
import { log } from './log.js';
import {
  fail,
  requireBoolean,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './config-validation-primitives.js';

const SENIORITY_VALUES: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];

function isSeniority(v: unknown): v is Seniority {
  if (typeof v !== 'string') return false;
  for (const s of SENIORITY_VALUES) {
    if (s === v) return true;
  }
  return false;
}

// Exhaustiveness-checked against the classifier's RoleFamily union: adding a family
// to classify.ts without listing it here is a compile error.
const ROLE_FAMILY_SLUGS: Record<RoleFamily, true> = {
  backend: true,
  frontend: true,
  fullstack: true,
  mobile: true,
  ml: true,
  data: true,
  security: true,
  devops: true,
  sre: true,
  pm: true,
  sales: true,
  ops: true,
  designer: true,
  analyst: true,
  marketing: true,
  support: true,
  finance: true,
  'solutions-architect': true,
};

function isRoleFamilySlug(v: string): v is RoleFamily {
  return Object.prototype.hasOwnProperty.call(ROLE_FAMILY_SLUGS, v);
}

// The filter compares profile.roleFamily against detectRoleFamily output, so human
// strings ("Backend Engineer") must become classifier slugs here or they never match.
// Unmappable values warn-and-drop rather than fail: roleFamily is open free text
// (unlike the seniority enum), and a kept unmappable entry could never match anyway.
function normalizeRoleFamily(values: readonly string[]): readonly string[] {
  const out: RoleFamily[] = [];
  const unmapped: string[] = [];
  for (const raw of values) {
    const lowered = raw.trim().toLowerCase();
    const mapped = isRoleFamilySlug(lowered) ? lowered : detectRoleFamily(raw, '');
    if (mapped === undefined) {
      unmapped.push(raw);
      continue;
    }
    if (!out.includes(mapped)) out.push(mapped);
  }
  if (unmapped.length > 0) {
    log('warn', 'config.role_family_unmapped', {
      unmapped,
      kept: out,
      validSlugs: Object.keys(ROLE_FAMILY_SLUGS),
    });
  }
  return out;
}

function warnIfCountryFilterOff(location: string, allowedCountries: unknown): void {
  if (allowedCountries !== undefined) return;
  const detected = detectCountryFromLocation(location);
  if (detected === undefined) return;
  log('warn', 'config.allowed_countries_missing', {
    location,
    detectedCountry: detected,
  });
}

function validateProfile(raw: unknown): ProfileConfig {
  const obj = requireRecord(raw, 'profile');
  const seniority = obj['seniority'];
  if (!isSeniority(seniority)) {
    fail(`expected one of ${SENIORITY_VALUES.join(',')} at field profile.seniority`);
  }
  const location = requireString(obj['location'], 'profile.location');
  warnIfCountryFilterOff(location, obj['allowedCountries']);
  return {
    resumeDumpPath: expandHome(requireString(obj['resumeDumpPath'], 'profile.resumeDumpPath')),
    skills: requireStringArray(obj['skills'], 'profile.skills'),
    ...(obj['coreSkills'] !== undefined
      ? { coreSkills: requireStringArray(obj['coreSkills'], 'profile.coreSkills') }
      : {}),
    location,
    remoteOk: requireBoolean(obj['remoteOk'], 'profile.remoteOk'),
    salaryFloor: requireNumber(obj['salaryFloor'], 'profile.salaryFloor'),
    seniority,
    roleFamily: normalizeRoleFamily(requireStringArray(obj['roleFamily'], 'profile.roleFamily')),
    ...(obj['strictLocation'] !== undefined
      ? { strictLocation: requireBoolean(obj['strictLocation'], 'profile.strictLocation') }
      : {}),
    ...(obj['allowedCountries'] !== undefined
      ? { allowedCountries: requireStringArray(obj['allowedCountries'], 'profile.allowedCountries') }
      : {}),
  };
}

function positiveOr(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function validateTriage(raw: unknown): TriageConfig {
  if (raw === undefined) return { model: 'sonnet', chunkSize: 150, triageK: 1000 };
  const obj = requireRecord(raw, 'ranking.triage');
  return {
    model:
      obj['model'] !== undefined
        ? requireString(obj['model'], 'ranking.triage.model')
        : 'sonnet',
    chunkSize:
      obj['chunkSize'] !== undefined
        ? positiveOr(requireNumber(obj['chunkSize'], 'ranking.triage.chunkSize'), 150)
        : 150,
    triageK:
      obj['triageK'] !== undefined
        ? positiveOr(requireNumber(obj['triageK'], 'ranking.triage.triageK'), 1000)
        : 1000,
  };
}

function validateSemantic(raw: unknown): SemanticConfig {
  if (raw === undefined) return { enabled: false };
  const obj = requireRecord(raw, 'ranking.semantic');
  const enabled = requireBoolean(obj['enabled'], 'ranking.semantic.enabled');
  return {
    enabled,
    ...(obj['model'] !== undefined
      ? { model: requireString(obj['model'], 'ranking.semantic.model') }
      : {}),
    ...(obj['candidateLimit'] !== undefined
      ? {
          candidateLimit: positiveOr(
            requireNumber(obj['candidateLimit'], 'ranking.semantic.candidateLimit'),
            DEFAULT_SEMANTIC_CANDIDATE_LIMIT,
          ),
        }
      : {}),
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
      persistK: 1000,
      triage: validateTriage(undefined),
      semantic: validateSemantic(undefined),
      rerank: validateRerank(undefined),
      history: validateHistory(undefined),
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
    persistK:
      obj['persistK'] !== undefined
        ? positiveOr(requireNumber(obj['persistK'], 'ranking.persistK'), 1000)
        : 1000,
    triage: validateTriage(obj['triage']),
    semantic: validateSemantic(obj['semantic']),
    rerank: validateRerank(obj['rerank']),
    history: validateHistory(obj['history']),
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

export function validateConfig(raw: unknown): JobDigestConfig {
  const obj = requireRecord(raw, '<root>');
  return {
    profile: validateProfile(obj['profile']),
    sources: validateSources(obj['sources']),
    ranking: validateRanking(obj['ranking']),
    output: validateOutput(obj['output']),
    rules: validateRules(obj['rules']),
  };
}
