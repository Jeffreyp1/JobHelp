import type { JobDigestConfig, NormalizedJob, Seniority } from '../types/index.js';
import { log } from '../lib/log.js';
import { detectRoleFamily, detectSeniorityLevel, isGhostJob } from './classify.js';

const SENIORITY_LADDER: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];
const STRICT_SENIOR_PROFILES: ReadonlySet<Seniority> = new Set(['intern', 'entry', 'mid']);
const STRICT_SENIOR_TITLE_RE = /\b(staff|principal|director|head of)\b/i;

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

function dropsForRemote(job: NormalizedJob, config: JobDigestConfig): boolean {
  return job.remote === 'remote' && config.profile.remoteOk === false;
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

/**
 * Drop jobs that are confidently incompatible with the profile.
 *
 *   - ghost / template / placeholder titles, or descriptions too short to be real postings
 *   - role-family mismatch (only when the profile opts in via non-empty roleFamily)
 *   - strict-senior: staff/principal/director titles for intern/entry/mid profiles
 *   - remote-only postings when the candidate is onsite-only
 *   - salaryMax below the candidate's salary floor
 *   - seniority signal in title/description >=2 steps from the candidate's level
 *
 * Missing data NEVER drops — only confidently incompatible postings are removed.
 * Drop order is fixed so ghost/role-family run before the cheaper field checks.
 */
export async function filter(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
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
    if (dropsForRemote(job, config)) {
      log('debug', 'filter.drop_remote', { id: job.id });
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
    out.push(job);
  }
  return out;
}
