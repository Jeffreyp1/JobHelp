import type { ProfileConfig, RankedJob } from '../types/index.js';
import { log } from '../lib/log.js';

export type Tier = 'strong' | 'solid' | 'borderline' | 'drop';

export interface AIJudgment {
  readonly id: string;
  readonly tier: Tier;
  readonly rationale: string;
}

// Judger fn injected so this stage is unit-testable and provider-agnostic.
export type Judger = (
  jobs: readonly RankedJob[],
  profile: ProfileConfig,
) => Promise<readonly AIJudgment[]>;

export interface AIFilterResult {
  readonly tiered: {
    readonly strong: readonly RankedJob[];
    readonly solid: readonly RankedJob[];
    readonly borderline: readonly RankedJob[];
    readonly dropped: readonly RankedJob[];
  };
  readonly judgments: readonly AIJudgment[];
  readonly survivors: readonly RankedJob[];
}

const ALL_TIERS: ReadonlyArray<Tier> = ['strong', 'solid', 'borderline', 'drop'];

export async function aiFilter(
  ranked: readonly RankedJob[],
  profile: ProfileConfig,
  judger: Judger,
  acceptTiers: ReadonlyArray<Tier> = ['strong', 'solid'],
): Promise<AIFilterResult> {
  if (ranked.length === 0) {
    return {
      tiered: { strong: [], solid: [], borderline: [], dropped: [] },
      judgments: [],
      survivors: [],
    };
  }

  const judgments = await judger(ranked, profile);
  const byId = new Map<string, Tier>();
  for (const j of judgments) byId.set(j.id, j.tier);

  const buckets: Record<Tier, RankedJob[]> = { strong: [], solid: [], borderline: [], drop: [] };
  for (const r of ranked) {
    const tier = byId.get(r.job.id) ?? 'borderline';
    if (!ALL_TIERS.includes(tier)) {
      log('warn', 'ai-filter.invalid_tier', { id: r.job.id, tier });
      buckets.borderline.push(r);
      continue;
    }
    buckets[tier].push(r);
  }

  const accepted = new Set<Tier>(acceptTiers);
  const survivors = ranked.filter((r) => accepted.has(byId.get(r.job.id) ?? 'borderline'));

  return {
    tiered: {
      strong: buckets.strong,
      solid: buckets.solid,
      borderline: buckets.borderline,
      dropped: buckets.drop,
    },
    judgments,
    survivors,
  };
}

// Default prompt used by SDK-backed judger; exported so callers can override.
export function buildAIFilterPrompt(jobs: readonly RankedJob[], profile: ProfileConfig): string {
  const skills = profile.skills.join(', ');
  const family = profile.roleFamily.join(', ');
  const list = jobs.map((r) => `${r.job.id} | ${r.job.title} @ ${r.job.company} | ${r.job.location} | remote=${r.job.remote}`).join('\n');
  return `You are filtering ${jobs.length} ranked jobs for a candidate.

Profile:
- skills: ${skills}
- seniority: ${profile.seniority}
- roleFamily: ${family}
- salaryFloor: ${profile.salaryFloor}
- remoteOk: ${profile.remoteOk}

Jobs (id | title @ company | location | remote):
${list}

For each job emit one line as JSON: {"id":"<id>","tier":"<strong|solid|borderline|drop>","rationale":"<≤15 words>"}.
Tiers:
- strong: title + seniority + stack clearly align with profile.
- solid: 2 of 3 align; one notable gap (e.g., specialty subdomain).
- borderline: 1 aligns or significant gap.
- drop: explicit mismatch (mgmt/non-eng role, wrong domain, wrong geo).

Output: one JSON object per line, no preamble, no markdown fences.`;
}
