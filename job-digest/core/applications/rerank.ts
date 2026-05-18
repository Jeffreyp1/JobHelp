import { getLatestDigest, getLatestPointerPath } from '../state/digestStore.js';
import type { Registry } from '../resumes/registry.js';
import type { RankedJob } from '../types/index.js';
import { err, ok, type Result } from '../types/result.js';

const DEFAULT_TOP_K = 30;
const MAX_TOP_K = 50;

export interface RerankBundle {
  readonly jobs: ReadonlyArray<RankedJob>;
  readonly resume: { readonly name: string; readonly content: string };
  readonly rerankPrompt: string;
  readonly summary: {
    readonly topK: number;
    readonly resumeChars: number;
    readonly totalJDBytes: number;
    readonly digestDate: string;
    readonly digestPath: string;
  };
}

export interface RerankOptions {
  readonly topK?: number;
  readonly instructions?: string;
}

export interface RerankError {
  readonly type: 'no_digest' | 'no_active_resume' | 'io_error';
  readonly message: string;
}

function clampTopK(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_TOP_K;
  if (!Number.isFinite(requested) || requested < 1) return 1;
  if (requested > MAX_TOP_K) return MAX_TOP_K;
  return Math.floor(requested);
}

function buildRerankPrompt(topK: number, instructions: string | undefined): string {
  const emphasis = instructions !== undefined && instructions.trim().length > 0
    ? instructions.trim()
    : '(none)';
  return `Rerank ${topK} jobs against the candidate's resume to surface the strongest fits.

## Inputs
- ${topK} jobs from a deterministic Stage 1 ranker (BM25F + recency + role-fit).
- Resume content (separate field).
- User emphasis: ${emphasis}

## Tiers
- Strong: title + JD + seniority + stack align with resume.
- Solid: 2 of 3 align; one notable gap.
- Borderline: 1 of 3 aligns, or gap in a critical area.
- Drop: explicit mismatch (years required, wrong domain/geo, wrong role type).

## Output
Markdown:
1. Tier 1 (Strong, apply first) - jobs with one-line rationale.
2. Tier 2 (Solid, decent shot) - same.
3. Tier 3 (Borderline, stretch) - same.
4. Dropped - brief table with reasons.

End with one line: "Recommended next action: ...".

Be honest. Don't pad. Drop noise aggressively.`;
}

export async function bundleRerank(
  registry: Registry,
  resumeName: string,
  options: RerankOptions = {},
): Promise<Result<RerankBundle, RerankError>> {
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

  const resumeRead = await registry.readResume({ name: resumeName });
  if (!resumeRead.ok) {
    if (resumeRead.error.type === 'no_active' || resumeRead.error.type === 'not_found') {
      return err({
        type: 'no_active_resume',
        message: 'No active resume registered.',
      });
    }
    return err({ type: 'io_error', message: resumeRead.error.message });
  }

  const topK = clampTopK(options.topK);
  const allJobs = latest.value.jobs;
  const jobs = allJobs.slice(0, topK);
  if (jobs.length === 0) {
    return err({ type: 'no_digest', message: 'Latest digest contains no ranked jobs.' });
  }

  const resumeContent = resumeRead.value;

  const totalJDBytes = jobs.reduce(
    (acc: number, j: RankedJob) => acc + j.job.description.length,
    0,
  );

  const rerankPrompt = buildRerankPrompt(jobs.length, options.instructions);

  return ok({
    jobs,
    resume: { name: resumeName, content: resumeContent },
    rerankPrompt,
    summary: {
      topK: jobs.length,
      resumeChars: resumeContent.length,
      totalJDBytes,
      digestDate: latest.value.date,
      digestPath: getLatestPointerPath(),
    },
  });
}
