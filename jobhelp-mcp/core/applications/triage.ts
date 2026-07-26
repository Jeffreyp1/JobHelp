import { getLatestDigest } from '../state/digestStore.js';
import { escapeRegExp } from '../lib/regexp.js';
import type { JobDigestConfig, ProfileConfig } from '../types/config.js';
import type { RankedJob } from '../types/index.js';
import { err, ok, type Result } from '../types/result.js';
import type { RerankError } from './rerank.js';

const MAX_MATCHED_SKILLS = 6;
const DEFAULT_TRIAGE_K = 1000;

export interface TriageBundle {
  readonly total: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly triage: { readonly model: string; readonly chunkSize: number };
  readonly profileCard: string;
  readonly lines: readonly string[];
}

export interface TriageOptions {
  readonly triageK?: number;
  readonly appliedJobIds?: ReadonlySet<string>;
}

function matchedSkills(r: RankedJob, skills: readonly string[]): readonly string[] {
  const haystack = `${r.job.title} ${r.job.description}`.toLowerCase();
  const hits: string[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`);
    if (re.test(haystack)) {
      hits.push(trimmed);
      if (hits.length === MAX_MATCHED_SKILLS) break;
    }
  }
  return hits;
}

// Source-controlled fields must not smuggle the line's own delimiters into the triage format.
function sanitizeField(s: string): string {
  return s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildTriageLine(
  r: RankedJob,
  skills: readonly string[],
  applied?: ReadonlySet<string>,
): string {
  const matched = matchedSkills(r, skills);
  const skillsField = matched.length > 0 ? matched.join(',') : '-';
  const posted = r.job.postedAt !== undefined && r.job.postedAt !== '' ? r.job.postedAt : 'undated';
  const title = sanitizeField(r.job.title);
  const company = sanitizeField(r.job.company);
  const location = sanitizeField(r.job.location);
  const line = `${r.rank}. ${r.job.id} | ${title} @ ${company} | ${location} | ${r.job.remote} | ${posted} | skills:${skillsField} | s=${r.score.toFixed(4)}`;
  return applied?.has(r.job.id) === true ? `${line} | APPLIED` : line;
}

export function buildProfileCard(profile: ProfileConfig): string {
  const countries =
    profile.allowedCountries !== undefined && profile.allowedCountries.length > 0
      ? profile.allowedCountries.join(', ')
      : 'unrestricted';
  return [
    'Candidate profile:',
    `- skills: ${profile.skills.join(', ')}`,
    `- seniority: ${profile.seniority}`,
    `- roleFamily: ${profile.roleFamily.join(', ')}`,
    `- salaryFloor: ${profile.salaryFloor}`,
    `- remoteOk: ${profile.remoteOk}`,
    `- location: ${profile.location}`,
    `- allowedCountries: ${countries}`,
  ].join('\n');
}

export async function bundleTriage(
  config: JobDigestConfig,
  options: TriageOptions = {},
): Promise<Result<TriageBundle, RerankError>> {
  const latest = await getLatestDigest();
  if (!latest.ok) {
    if (latest.error.type === 'not_found') {
      return err({
        type: 'no_digest',
        message: 'No digest available - call find_matching_jobs first.',
      });
    }
    return err({ type: 'io_error', message: latest.error.message });
  }
  const all = latest.value.jobs;
  if (all.length === 0) {
    return err({ type: 'no_digest', message: 'Latest digest contains no ranked jobs.' });
  }

  const triageCfg = config.ranking.triage;
  const configCap = triageCfg?.triageK ?? DEFAULT_TRIAGE_K;
  const requested = options.triageK;
  const cap =
    requested !== undefined && Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), configCap)
      : configCap;
  const selected = all.slice(0, cap);

  const skills = config.profile.skills;
  return ok({
    total: all.length,
    returned: selected.length,
    truncated: selected.length < all.length,
    triage: {
      model: triageCfg?.model ?? 'sonnet',
      chunkSize: triageCfg?.chunkSize ?? 150,
    },
    profileCard: buildProfileCard(config.profile),
    lines: selected.map((r) => buildTriageLine(r, skills, options.appliedJobIds)),
  });
}
