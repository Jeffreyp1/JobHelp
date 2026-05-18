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

function dropsForGhost(job: NormalizedJob): boolean {
  return isGhostJob(job);
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

// Intern + new-grad postings should only survive when the profile is itself seeking intern roles.
// Existing distance rule (>=2 steps) keeps intern visible for entry profiles (distance 1); this
// helper closes that gap explicitly so an "entry" candidate doesn't get summer-internship noise.
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

// Conservative: drops "Lead Backend Engineer" for entry profiles.
// Intern handling is fully delegated to dropsForInternMismatch, which runs before this.
function dropsForLeadInTitle(job: NormalizedJob, config: JobDigestConfig): boolean {
  if (config.profile.seniority !== 'entry') return false;
  return LEAD_TITLE_RE.test(job.title);
}

function dropsForRemote(job: NormalizedJob, config: JobDigestConfig): boolean {
  return job.remote === 'remote' && config.profile.remoteOk === false;
}

// Geo allowlist: lenient on bare 'Remote' (undetected country survives) so
// remote postings without a stated region aren't accidentally filtered. Strict
// when the location names a confidently non-allowlist country or region.
// Note: allowedCountries values are matched LITERALLY against detectCountryFromLocation's
// output. Regional buckets ('EU', 'APAC', 'LATAM') don't subsume their member countries —
// `['EU']` keeps "Remote - Europe" but drops "Remote - Germany". Users wanting
// pan-European coverage should list `['EU', 'Germany', 'France', 'Spain', ...]`.
function dropsForCountry(job: NormalizedJob, profile: ProfileConfig): boolean {
  const allowlist = profile.allowedCountries;
  if (allowlist === undefined || allowlist.length === 0) return false;

  const detected = detectCountryFromLocation(job.location);

  if (job.remote === 'remote') {
    if (detected === undefined) return false;
    if (allowlist.includes(detected)) return false;
    return true;
  }

  if (detected === undefined) return false;
  if (allowlist.includes(detected)) return false;
  return true;
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

// Boundary: a job with ageDays exactly equal to cfg.days is KEPT (strict >).
// `days: 1` means "today + yesterday survive"; jobs older than 1 day drop.
export function dropForAge(job: NormalizedJob, cfg: MaxAgeConfig, now: Date): boolean {
  if (!cfg.enabled) return false;
  // Empty string treated as absent (lenient): some adapters emit '' as a sentinel.
  if (job.postedAt === undefined || job.postedAt === '') {
    if (cfg.requireDate) {
      log('debug', 'filter.drop_age_undated', { id: job.id, source: job.source });
      return true;
    }
    return false;
  }
  if (!Number.isFinite(now.getTime())) {
    log('warn', 'filter.drop_age_invalid_now', {
      id: job.id,
      source: job.source,
    });
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

/**
 * Drop jobs that are confidently incompatible with the profile.
 *
 *   - ghost / template / placeholder titles, or descriptions too short to be real postings
 *   - role-family mismatch (only when the profile opts in via non-empty roleFamily)
 *   - strict-senior: staff/principal/director titles for intern/entry/mid profiles
 *   - intern-mismatch: intern/internship/new-grad titles for non-intern profiles
 *   - remote-only postings when the candidate is onsite-only
 *   - country mismatch when profile.allowedCountries is non-empty (lenient on bare 'Remote')
 *   - salaryMax below the candidate's salary floor
 *   - seniority signal in title/description >=2 steps from the candidate's level
 *   - postedAt older than config.ranking.maxAge.days (toggleable; lenient on missing date)
 *
 * Missing data NEVER drops — only confidently incompatible postings are removed,
 * except when `maxAge.requireDate` is true (strict mode).
 * Drop order is fixed so ghost/role-family run before the cheaper field checks;
 * age runs LAST so log messages for date-shaped drops surface only after structural
 * mismatches are already filtered.
 *
 * `now` is injectable so tests can pin the clock; defaults to wall-clock at call time.
 */
export async function filter(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  now: Date = new Date(),
): Promise<readonly NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (const job of jobs) {
    if (dropsForGhost(job)) {
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
      log('debug', 'filter.drop_engineer_level', {
        id: job.id,
        source: job.source,
        title: job.title,
      });
      continue;
    }
    if (dropsForSeniorInTitle(job, config)) {
      log('debug', 'filter.drop_senior_in_title', {
        id: job.id,
        source: job.source,
        title: job.title,
      });
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
      log('debug', 'filter.drop_lead_in_title', {
        id: job.id,
        source: job.source,
        title: job.title,
      });
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
