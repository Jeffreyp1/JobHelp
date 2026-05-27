import type { JobDigestConfig } from '../../core/types/config.js';
import type { JobId, NormalizedJob } from '../../core/types/job.js';
import type { RankedJob } from '../../core/types/pipeline.js';
import { err, ok, type Result } from '../../core/types/result.js';
import {
  getDigestCsvPath,
  getDigestMarkdownPath,
  persistDigest,
  getLatestDigest,
  getLatestPointerPath,
} from '../../core/state/digestStore.js';
import { ALL_ADAPTERS } from '../../core/sources/index.js';
import { runPipeline, type PipelineOverrides } from '../../core/pipeline/index.js';
import type {
  FindMatchingJobsArgs,
  FindMatchingJobsResult,
  GetJobResult,
  GetLatestDigestResult,
  ScoreKeywordMatchArgs,
  ScoreKeywordMatchResult,
  ToolError,
} from './tools-types.js';
import {
  extractSkillsFromMarkdown,
  runAdapterIsolated,
  scoreOverlap,
  todayIsoDate,
  toToolError,
} from './wiring-helpers.js';

export async function findJobInLatestDigest(
  id: string,
): Promise<Result<NormalizedJob, ToolError>> {
  const latest = await getLatestDigest();
  if (!latest.ok) {
    if (latest.error.type === 'not_found') {
      return err({ type: 'not_found', message: latest.error.message });
    }
    return err(toToolError(latest.error));
  }
  const ranked = latest.value.jobs.find((r: RankedJob) => r.job.id === id);
  if (ranked === undefined) {
    return err({ type: 'not_found', message: `job not found in latest digest: ${id}` });
  }
  return ok(ranked.job);
}

export async function handleFindMatchingJobs(
  config: JobDigestConfig,
  args: FindMatchingJobsArgs,
): Promise<Result<FindMatchingJobsResult, ToolError>> {
  const now = new Date();
  const outcomes = await Promise.all(
    ALL_ADAPTERS.map((a) => runAdapterIsolated(a, config)),
  );
  const pool: NormalizedJob[] = [];
  const warnings: { source: string; message: string }[] = [];
  for (const o of outcomes) {
    for (const j of o.jobs) pool.push(j);
    if (o.error !== undefined) warnings.push({ source: o.source, message: o.error.message });
  }
  if (pool.length === 0 && warnings.length === ALL_ADAPTERS.length) {
    return err({
      type: 'all_sources_failed',
      message: 'all source adapters failed or are unconfigured',
    });
  }
  const overrides: PipelineOverrides = {
    now,
    ...(args.maxAgeDays === null || typeof args.maxAgeDays === 'number'
      ? { maxAgeDays: args.maxAgeDays }
      : {}),
    ...(args.recencyEnabled !== undefined ? { recencyEnabled: args.recencyEnabled } : {}),
  };
  const ranked = await runPipeline(pool, config, overrides);
  const topK = ranked.slice(0, args.count ?? config.ranking.digestK);
  const date = todayIsoDate(now);
  const persisted = await persistDigest({
    date,
    generatedAt: now.toISOString(),
    totalDurationMs: 0,
    sourceResults: outcomes.map((o) => ({
      source: o.source,
      jobCount: o.jobs.length,
      durationMs: 0,
      ...(o.error !== undefined
        ? { error: { type: 'unknown' as const, message: o.error.message } }
        : {}),
    })),
    jobs: topK,
  });
  if (!persisted.ok) return err(toToolError(persisted.error));
  return ok({
    digestPath: persisted.value.path,
    markdownPath: persisted.value.markdownPath,
    csvPath: persisted.value.csvPath,
    jobs: topK,
    warnings,
  });
}

export async function handleGetLatestDigest(): Promise<
  Result<GetLatestDigestResult, ToolError>
> {
  const r = await getLatestDigest();
  if (!r.ok) {
    if (r.error.type === 'not_found') {
      return err({ type: 'not_found', message: r.error.message });
    }
    return err(toToolError(r.error));
  }
  return ok({
    path: getLatestPointerPath(),
    markdownPath: getDigestMarkdownPath(r.value.date),
    csvPath: getDigestCsvPath(r.value.date),
    jobs: r.value.jobs,
    generatedAt: r.value.generatedAt,
  });
}

export async function handleGetJob(id: JobId): Promise<Result<GetJobResult, ToolError>> {
  const job = await findJobInLatestDigest(id);
  if (!job.ok) return err(job.error);
  return ok({ job: job.value });
}

export async function handleScoreKeywordMatch(
  args: ScoreKeywordMatchArgs,
): Promise<Result<ScoreKeywordMatchResult, ToolError>> {
  const job = await findJobInLatestDigest(args.jobId);
  if (!job.ok) return err(job.error);
  const skills = extractSkillsFromMarkdown(args.resumeMarkdown);
  const jobText = `${job.value.title} ${job.value.description}`;
  const { score, matched, missing } = scoreOverlap(jobText, skills);
  return ok({ score, matched, missing });
}
