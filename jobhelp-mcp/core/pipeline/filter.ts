import type { JobDigestConfig, NormalizedJob } from '../types/index.js';
import { log } from '../lib/log.js';
import { detectRoleFamily, isGhostJob } from './classify.js';
import {
  dropForAge,
  dropsForCountry,
  dropsForEngineerLevel,
  dropsForInternMismatch,
  dropsForLeadInTitle,
  dropsForObviousNonSoftware,
  dropsForRemote,
  dropsForRoleFamily,
  dropsForSalary,
  dropsForSeniorInTitle,
  dropsForSeniority,
  dropsForStrictSenior,
  dropsForUnknownCountry,
} from './filterRules.js';

export { dropForAge } from './filterRules.js';

export type DropReason =
  | 'ghost'
  | 'non_software'
  | 'role_family'
  | 'strict_senior'
  | 'engineer_level'
  | 'senior_in_title'
  | 'intern_mismatch'
  | 'lead_in_title'
  | 'remote'
  | 'country'
  | 'country_unknown'
  | 'salary'
  | 'seniority_distance'
  | 'age';

interface DropRule {
  readonly reason: DropReason;
  readonly drops: (job: NormalizedJob, config: JobDigestConfig, now: Date) => boolean;
  readonly logDrop?: (job: NormalizedJob, config: JobDigestConfig) => void;
}

// Rule order is the drop order: ghost/role-family run before cheaper field checks; age runs
// LAST so date-shaped drop logs surface only after structural mismatches are already filtered.
// Invariant: missing data NEVER drops (except when maxAge.requireDate=true or the opt-in
// strictLocation rule meets a named-but-unclassifiable place).
// The age rule has no logDrop because dropForAge logs its own detail during evaluation.
const DROP_RULES: readonly DropRule[] = [
  {
    reason: 'ghost',
    drops: (job) => isGhostJob(job),
    logDrop: (job) =>
      log('warn', 'filter.drop_ghost', { id: job.id, source: job.source, reason: 'ghost_or_template' }),
  },
  {
    reason: 'non_software',
    drops: (job) => dropsForObviousNonSoftware(job),
    logDrop: (job) =>
      log('debug', 'filter.drop_obvious_non_software', { id: job.id, source: job.source, title: job.title }),
  },
  {
    reason: 'role_family',
    drops: dropsForRoleFamily,
    logDrop: (job, config) =>
      log('debug', 'filter.drop_role_family', {
        id: job.id,
        source: job.source,
        detected: detectRoleFamily(job.title, job.description),
        allowed: config.profile.roleFamily,
      }),
  },
  {
    reason: 'strict_senior',
    drops: dropsForStrictSenior,
    logDrop: (job, config) =>
      log('debug', 'filter.drop_strict_senior', {
        id: job.id,
        source: job.source,
        profileSeniority: config.profile.seniority,
      }),
  },
  {
    reason: 'engineer_level',
    drops: dropsForEngineerLevel,
    logDrop: (job) =>
      log('debug', 'filter.drop_engineer_level', { id: job.id, source: job.source, title: job.title }),
  },
  {
    reason: 'senior_in_title',
    drops: dropsForSeniorInTitle,
    logDrop: (job) =>
      log('debug', 'filter.drop_senior_in_title', { id: job.id, source: job.source, title: job.title }),
  },
  {
    reason: 'intern_mismatch',
    drops: dropsForInternMismatch,
    logDrop: (job, config) =>
      log('debug', 'filter.drop_intern_mismatch', {
        id: job.id,
        source: job.source,
        profileSeniority: config.profile.seniority,
      }),
  },
  {
    reason: 'lead_in_title',
    drops: dropsForLeadInTitle,
    logDrop: (job) =>
      log('debug', 'filter.drop_lead_in_title', { id: job.id, source: job.source, title: job.title }),
  },
  {
    reason: 'remote',
    drops: dropsForRemote,
    logDrop: (job) => log('debug', 'filter.drop_remote', { id: job.id }),
  },
  {
    reason: 'country',
    drops: (job, config) => dropsForCountry(job, config.profile),
    logDrop: (job) =>
      log('debug', 'filter.drop_country', { id: job.id, source: job.source, location: job.location }),
  },
  {
    reason: 'country_unknown',
    drops: (job, config) => dropsForUnknownCountry(job, config.profile),
    logDrop: (job) =>
      log('debug', 'filter.drop_country_unknown', { id: job.id, source: job.source, location: job.location }),
  },
  {
    reason: 'salary',
    drops: dropsForSalary,
    logDrop: (job) => log('debug', 'filter.drop_salary', { id: job.id, salaryMax: job.salaryMax }),
  },
  {
    reason: 'seniority_distance',
    drops: dropsForSeniority,
    logDrop: (job) => log('debug', 'filter.drop_seniority', { id: job.id, title: job.title }),
  },
  {
    reason: 'age',
    drops: (job, config, now) =>
      config.ranking.maxAge !== undefined && dropForAge(job, config.ranking.maxAge, now),
  },
];

function firstDropRule(job: NormalizedJob, config: JobDigestConfig, now: Date): DropRule | undefined {
  return DROP_RULES.find((rule) => rule.drops(job, config, now));
}

export function dropReasonFor(
  job: NormalizedJob,
  config: JobDigestConfig,
  now: Date = new Date(),
): DropReason | undefined {
  return firstDropRule(job, config, now)?.reason;
}

// Log-free per-job gate sharing the exact rule table and order used by filter().
// Adapters apply this at their accumulation site so rejected jobs never pile up in
// memory; filter() still runs later (idempotent) and keeps the per-drop logging.
export function makeAcceptPredicate(
  config: JobDigestConfig,
  now: Date = new Date(),
): (job: NormalizedJob) => boolean {
  return (job: NormalizedJob): boolean => firstDropRule(job, config, now) === undefined;
}

export interface AcceptCounter {
  accept(job: NormalizedJob): boolean;
  counts(): Readonly<Record<string, number>>;
  kept(): number;
}

export function makeAcceptCounter(config: JobDigestConfig, now: Date = new Date()): AcceptCounter {
  const counts: Record<string, number> = {};
  let keptCount = 0;
  return {
    accept: (job: NormalizedJob): boolean => {
      const rule = firstDropRule(job, config, now);
      if (rule !== undefined) {
        counts[rule.reason] = (counts[rule.reason] ?? 0) + 1;
        return false;
      }
      keptCount += 1;
      return true;
    },
    counts: () => ({ ...counts }),
    kept: () => keptCount,
  };
}

export async function filter(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  now: Date = new Date(),
): Promise<readonly NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (const job of jobs) {
    const rule = firstDropRule(job, config, now);
    if (rule === undefined) {
      out.push(job);
      continue;
    }
    rule.logDrop?.(job, config);
  }
  return out;
}
