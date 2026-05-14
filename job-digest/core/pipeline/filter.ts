import type { JobDigestConfig, NormalizedJob, Seniority } from '../types/index.js';
import { log } from '../lib/log.js';

const SENIORITY_LADDER: readonly Seniority[] = ['intern', 'entry', 'mid', 'senior', 'staff'];

const INTERN_RE = /\b(intern|internship)\b/i;
const SENIOR_PLUS_RE = /\b(staff|principal|director|head of|lead engineer|sr\.|senior)\b/i;
const STAFF_RE = /\b(staff|principal|director|head of)\b/i;

function seniorityIndex(level: Seniority): number {
  return SENIORITY_LADDER.indexOf(level);
}

/**
 * Best-effort seniority signal extraction.
 * Returns undefined when no confident signal is present (then filter must keep the job).
 */
function detectSeniority(text: string): Seniority | undefined {
  if (INTERN_RE.test(text)) return 'intern';
  if (SENIOR_PLUS_RE.test(text)) {
    if (STAFF_RE.test(text)) return 'staff';
    return 'senior';
  }
  return undefined;
}

function dropsForRemote(job: NormalizedJob, config: JobDigestConfig): boolean {
  return job.remote === 'remote' && config.profile.remoteOk === false;
}

function dropsForSalary(job: NormalizedJob, config: JobDigestConfig): boolean {
  return typeof job.salaryMax === 'number' && job.salaryMax < config.profile.salaryFloor;
}

function dropsForSeniority(job: NormalizedJob, config: JobDigestConfig): boolean {
  const signal = detectSeniority(`${job.title} ${job.description}`);
  if (signal === undefined) return false;
  const distance = Math.abs(seniorityIndex(signal) - seniorityIndex(config.profile.seniority));
  return distance >= 2;
}

/**
 * Drop jobs that are confidently incompatible with the profile.
 *
 *   - remote-only postings when the candidate is onsite-only
 *   - salaryMax below the candidate's salary floor
 *   - seniority signal in title/description >=2 steps from the candidate's level
 *
 * Missing data NEVER drops — only confidently incompatible postings are removed.
 */
export async function filter(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (const job of jobs) {
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
