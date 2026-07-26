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
    ...(obj['coreSkills'] !== undefined
      ? { coreSkills: requireStringArray(obj['coreSkills'], 'profile.coreSkills') }
      : {}),
    ...(obj['strictLocation'] !== undefined
      ? { strictLocation: requireBoolean(obj['strictLocation'], 'profile.strictLocation') }
      : {}),
  };
}

function positiveOr(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
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
