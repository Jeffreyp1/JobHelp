import type { JobDigestConfig, MaxAgeConfig, NormalizedJob, ProfileConfig, Seniority } from '../types/index.js';
import { log } from '../lib/log.js';
import { detectCountryFromLocation, detectRoleFamily, detectSeniorityLevel, isGhostJob } from './classify.js';

const SENIORITY_LADDER: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];
const STRICT_SENIOR_PROFILES: ReadonlySet<Seniority> = new Set(['intern', 'entry', 'mid']);
const STRICT_SENIOR_TITLE_RE = /\b(staff|principal|director|head of)\b/i;
const ENGINEER_LEVEL_RE = /\b(?:software\s+)?engineer\s+(?:II|III|IV)\b/i;
const SENIOR_TITLE_RE = /\bsenior\b|\bsr\.?\b/i;
const LEAD_TITLE_RE = /\blead\b/i;
const INTERN_TITLE_RE = /\b(intern|internship|new ?grad)\b/i;
const MS_PER_DAY = 86_400_000;

function seniorityIndex(level: Seniority): number {
  return SENIORITY_LADDER.indexOf(level);
}

function dropsForRoleFamily(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.roleFamily.length === 0) return false;
  const detected = detectRoleFamily(job.title, job.description);
  if (detected === undefined) return false;
  return !config.profile.roleFamily.includes(detected);
}

function dropsForStrictSenior(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (!STRICT_SENIOR_PROFILES.has(config.profile.seniority)) return false;
  return STRICT_SENIOR_TITLE_RE.test(job.title);
}

// Closes the gap left by the >=2-step seniority-distance rule (intern vs entry = distance 1).
function dropsForInternMismatch(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority === 'intern') return false;
  return INTERN_TITLE_RE.test(job.title);
}

function dropsForEngineerLevel(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return ENGINEER_LEVEL_RE.test(job.title);
}

function dropsForSeniorInTitle(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry' && config.profile.seniority !== 'mid') return false;
  return SENIOR_TITLE_RE.test(job.title);
}

function dropsForLeadInTitle(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return LEAD_TITLE_RE.test(job.title);
}

function dropsForRemote(job: NormalizedJob, config: JobDigestConfig): boolean {
  return job.remote === 'remote' && config.profile.remoteOk === false;
}

// allowedCountries matches detectCountryFromLocation output LITERALLY; region buckets
// ('EU', 'APAC', 'LATAM') do NOT subsume member countries. Bare 'Remote' (undetected) survives.
// Remote vs non-remote branches collapsed: both returned identical values for every (detected, allowlist) pair.
function dropsForCountry(job: NormalizedJob, profile: ProfileConfig): boolean {
  const allowlist = profile.allowedCountries;
  if (allowlist === undefined || allowlist.length === 0) return false;
  const detected = detectCountryFromLocation(job.location);
  if (detected === undefined) return false;
  return !allowlist.includes(detected);
}

function dropsForSalary(job: NormalizedJob, config: JobDigestConfig): boolean {
  return typeof job.salaryMax === 'number' && job.salaryMax < config.profile.salaryFloor;
}

function dropsForSeniority(job: NormalizedJob, config: JobDigestConfig): boolean {
  const signal = detectSeniorityLevel(job.title, job.description);
  if (signal === undefined) return false;
  const distance = Math.abs(seniorityIndex(signal) - seniorityIndex(config.profile.seniority));
  return distance >= 2;
}

// Boundary: ageDays exactly equal to cfg.days is KEPT (strict >).
export function dropForAge(job: NormalizedJob, cfg: MaxAgeConfig, now: Date): boolean {
  if (!cfg.enabled) return false;
  // Empty string treated as absent: some adapters emit '' as a sentinel.
  if (job.postedAt === undefined || job.postedAt === '') {
    if (cfg.requireDate) {
      log('debug', 'filter.drop_age_undated', { id: job.id, source: job.source });
      return true;
    }
    return false;
  }
  if (!Number.isFinite(now.getTime())) {
    log('warn', 'filter.drop_age_invalid_now', { id: job.id, source: job.source });
    return false;
  }
  const posted = Date.parse(job.postedAt);
  if (!Number.isFinite(posted)) {
    log('warn', 'filter.drop_age_unparseable', {
      id: job.id,
      source: job.source,
      postedAt: job.postedAt,
    });
    return cfg.requireDate;
  }
  const ageDays = (now.getTime() - posted) / MS_PER_DAY;
  if (ageDays > cfg.days) {
    log('debug', 'filter.drop_age_exceeded', {
      id: job.id,
      source: job.source,
      ageDays: Math.round(ageDays * 10) / 10,
      maxAgeDays: cfg.days,
    });
    return true;
  }
  return false;
}

// Drop order: ghost/role-family run before cheaper field checks; age runs LAST so date-shaped
// drop logs surface only after structural mismatches are already filtered.
// Invariant: missing data NEVER drops (except when maxAge.requireDate=true).
export async function filter(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  now: Date = new Date(),
): Promise<readonly NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (const job of jobs) {
    if (isGhostJob(job)) {
      log('warn', 'filter.drop_ghost', { id: job.id, source: job.source, reason: 'ghost_or_template' });
      continue;
    }
    if (dropsForRoleFamily(job, config)) {
      log('debug', 'filter.drop_role_family', {
        id: job.id,
        source: job.source,
        detected: detectRoleFamily(job.title, job.description),
        allowed: config.profile.roleFamily,
      });
      continue;
    }
    if (dropsForStrictSenior(job, config)) {
      log('debug', 'filter.drop_strict_senior', {
        id: job.id,
        source: job.source,
        profileSeniority: config.profile.seniority,
      });
      continue;
    }
    if (dropsForEngineerLevel(job, config)) {
      log('debug', 'filter.drop_engineer_level', { id: job.id, source: job.source, title: job.title });
      continue;
    }
    if (dropsForSeniorInTitle(job, config)) {
      log('debug', 'filter.drop_senior_in_title', { id: job.id, source: job.source, title: job.title });
      continue;
    }
    if (dropsForInternMismatch(job, config)) {
      log('debug', 'filter.drop_intern_mismatch', {
        id: job.id,
        source: job.source,
        profileSeniority: config.profile.seniority,
      });
      continue;
    }
    if (dropsForLeadInTitle(job, config)) {
      log('debug', 'filter.drop_lead_in_title', { id: job.id, source: job.source, title: job.title });
      continue;
    }
    if (dropsForRemote(job, config)) {
      log('debug', 'filter.drop_remote', { id: job.id });
      continue;
    }
    if (dropsForCountry(job, config.profile)) {
      log('debug', 'filter.drop_country', { id: job.id, source: job.source, location: job.location });
      continue;
    }
    if (dropsForSalary(job, config)) {
      log('debug', 'filter.drop_salary', { id: job.id, salaryMax: job.salaryMax });
      continue;
    }
    if (dropsForSeniority(job, config)) {
      log('debug', 'filter.drop_seniority', { id: job.id, title: job.title });
      continue;
    }
    if (config.ranking.maxAge !== undefined && dropForAge(job, config.ranking.maxAge, now)) {
      continue;
    }
    out.push(job);
  }
  return out;
}
