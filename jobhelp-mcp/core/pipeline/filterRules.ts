import type { JobDigestConfig, MaxAgeConfig, NormalizedJob, ProfileConfig, Seniority } from '../types/index.js';
import { log } from '../lib/log.js';
import { detectCountryFromLocation, detectRoleFamily, detectTitleSeniority } from './classify.js';
import { looksLikeConcretePlace } from './geo.js';

const SENIORITY_LADDER: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];
const STRICT_SENIOR_PROFILES: ReadonlySet<Seniority> = new Set(['intern', 'entry', 'mid']);
const STRICT_SENIOR_TITLE_RE = /\b(staff|principal|director|head of)\b/i;
// II excluded: "Engineer II" is ambiguous early-career at many US companies (audit found
// blind-verified keepers there), so it demotes in ranking instead of dropping here.
const ENGINEER_LEVEL_RE = /\b(?:software\s+)?engineer\s+(?:III|IV)\b/i;
const SENIOR_TITLE_RE = /\bsenior\b|\bsr\.?\b/i;
const LEAD_TITLE_RE = /\blead\b/i;
// "New grad" is deliberately absent: it marks a full-time entry-level role, not an internship.
const INTERN_TITLE_RE = /\b(intern|internship)\b/i;
const NON_SOFTWARE_HEALTHCARE_RE = /\b(?:registered\s+nurse|nurse|rn|lpn|physician|dentist|pharmacist|therapist|medical\s+assistant)\b/i;
// Requires the discipline word IMMEDIATELY before "engineer" (no "...ing" suffix), so a
// discipline used as a modifier of a software role ("Manufacturing Engineering Software
// Engineer") and software-adjacent titles ("Firmware Engineer", "Embedded Software
// Engineer", "Hardware Security Engineer") survive. Known trade-off: a leading
// "<discipline> Engineer, ..." still drops even if the body mentions software.
const NON_SOFTWARE_ENGINEERING_RE = /\b(?:mechanical|electrical|civil|chemical|industrial|biomedical|aerospace|structural|manufacturing|hardware|materials|environmental|petroleum|mining|nuclear|automotive|mechatronics)\s+engineer\b/i;
const NON_SOFTWARE_TRADES_RE = /\b(?:electrician|plumber|welder|machinist|carpenter|hvac|millwright|pipefitter)\b/i;
const MS_PER_DAY = 86_400_000;

function seniorityIndex(level: Seniority): number {
  return SENIORITY_LADDER.indexOf(level);
}

export function dropsForRoleFamily(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.roleFamily.length === 0) return false;
  const detected = detectRoleFamily(job.title, job.description);
  if (detected === undefined) return false;
  return !config.profile.roleFamily.includes(detected);
}

export function dropsForStrictSenior(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (!STRICT_SENIOR_PROFILES.has(config.profile.seniority)) return false;
  return STRICT_SENIOR_TITLE_RE.test(job.title);
}

// Closes the gap left by the >=2-step seniority-distance rule (intern vs entry = distance 1).
export function dropsForInternMismatch(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority === 'intern') return false;
  return INTERN_TITLE_RE.test(job.title);
}

export function dropsForEngineerLevel(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return ENGINEER_LEVEL_RE.test(job.title);
}

export function dropsForSeniorInTitle(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return SENIOR_TITLE_RE.test(job.title);
}

export function dropsForLeadInTitle(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return LEAD_TITLE_RE.test(job.title);
}

export function dropsForRemote(job: NormalizedJob, config: JobDigestConfig): boolean {
  return job.remote === 'remote' && config.profile.remoteOk === false;
}

export function dropsForObviousNonSoftware(job: NormalizedJob): boolean {
  return NON_SOFTWARE_HEALTHCARE_RE.test(job.title)
    || NON_SOFTWARE_ENGINEERING_RE.test(job.title)
    || NON_SOFTWARE_TRADES_RE.test(job.title);
}

// allowedCountries matches detectCountryFromLocation output LITERALLY; region buckets
// ('EU', 'APAC', 'LATAM') do NOT subsume member countries. Bare 'Remote' (undetected) survives.
// Remote vs non-remote branches collapsed: both returned identical values for every (detected, allowlist) pair.
export function dropsForCountry(job: NormalizedJob, profile: ProfileConfig): boolean {
  const allowlist = profile.allowedCountries;
  if (allowlist === undefined || allowlist.length === 0) return false;
  const detected = detectCountryFromLocation(job.location);
  if (detected === undefined) return false;
  return !allowlist.includes(detected);
}

// Opt-in tightening of the country rule: a NAMED place the detector cannot classify
// is presumed foreign. Arrangement-only locations ("Remote", "Hybrid") still survive.
export function dropsForUnknownCountry(job: NormalizedJob, profile: ProfileConfig): boolean {
  if (profile.strictLocation !== true) return false;
  const allowlist = profile.allowedCountries;
  if (allowlist === undefined || allowlist.length === 0) return false;
  if (detectCountryFromLocation(job.location) !== undefined) return false;
  return looksLikeConcretePlace(job.location);
}

export function dropsForSalary(job: NormalizedJob, config: JobDigestConfig): boolean {
  return typeof job.salaryMax === 'number' && job.salaryMax < config.profile.salaryFloor;
}

// Title-only: description-level seniority signals demote in ranking (seniorityPenalty)
// instead of dropping — a body mention is too weak a basis to lose the job entirely.
export function dropsForSeniority(job: NormalizedJob, config: JobDigestConfig): boolean {
  const signal = detectTitleSeniority(job.title);
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
