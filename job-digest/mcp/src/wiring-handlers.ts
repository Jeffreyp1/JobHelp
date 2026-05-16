import { readFile } from 'node:fs/promises';
import type { JobDigestConfig } from '../../core/types/config.js';
import type { JobId, NormalizedJob } from '../../core/types/job.js';
import type { RankedJob } from '../../core/types/pipeline.js';
import { err, ok, type Result } from '../../core/types/result.js';
import { applyConfigAnswers as coreApplyConfigAnswers, initConfig as coreInitConfig } from '../../core/init/index.js';
import type { Registry } from '../../core/resumes/registry.js';
import { readState } from '../../core/state/store.js';
import { persistDigest, getLatestDigest, getLatestPointerPath } from '../../core/state/digestStore.js';
import {
  startApplication as coreStartApplication, writeApplicationOutput as coreWriteApplicationOutput,
  listApplicationVersions as coreListApplicationVersions,
  listRecentApplications as coreListRecentApplications,
} from '../../core/applications/store.js';
import { ALL_ADAPTERS } from '../../core/sources/index.js';
import { runPipeline } from '../../core/pipeline/index.js';
import type {
  ApplyConfigAnswersArgs, ApplyConfigAnswersResult,
  FindMatchingJobsArgs, FindMatchingJobsResult, GetJobResult, GetLatestDigestResult,
  InitConfigArgs, InitConfigResult, ListApplicationVersionsArgs, ListApplicationVersionsResult,
  ListRecentApplicationsResult, ReadResumeResult, ReadRulesResult, RegisterResumeArgs,
  RegisterResumeResult, RulesMode as ToolRulesMode, ScoreKeywordMatchArgs, ScoreKeywordMatchResult,
  SetActiveResumeArgs, SetActiveResumeResult, StartApplicationArgs, StartApplicationResult,
  ToolError, WriteApplicationOutputArgs, WriteApplicationOutputResult,
} from './tools-types.js';
import {
  extractSkillsFromMarkdown, getConfigPath, loadRulesByMode, rulesToReadRulesResult,
  runAdapterIsolated, scoreOverlap, todayIsoDate, toToolError,
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

export async function handleInitConfig(
  args: InitConfigArgs,
): Promise<Result<InitConfigResult, ToolError>> {
  const interactive = args.interactive !== false;
  const wizard = coreInitConfig({ interactive });
  if (!wizard.ok) return err({ type: 'invalid_input', message: wizard.error.message });
  return ok({ created: false, path: getConfigPath() });
}

export async function handleApplyConfigAnswers(
  args: ApplyConfigAnswersArgs,
): Promise<Result<ApplyConfigAnswersResult, ToolError>> {
  const result = await coreApplyConfigAnswers(
    args.outputPath !== undefined
      ? { answers: args.answers, outputPath: args.outputPath }
      : { answers: args.answers },
  );
  if (!result.ok) return err(toToolError(result.error));
  return ok({ path: result.value.path });
}

export async function handleRegisterResume(
  registry: Registry,
  args: RegisterResumeArgs,
): Promise<Result<RegisterResumeResult, ToolError>> {
  let content = args.content;
  if (content === undefined) {
    if (args.path === undefined) {
      return err({ type: 'invalid_input', message: 'either path or content is required' });
    }
    try {
      content = await readFile(args.path, 'utf8');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'failed to read resume file';
      return err({ type: 'io_error', message });
    }
  }
  const result = await registry.registerResume({ name: args.name, content });
  if (!result.ok) return err(toToolError(result.error));
  const stateRead = await readState();
  const active = stateRead.ok && stateRead.value.activeResumeName === args.name;
  return ok({ name: result.value.name, storedAt: result.value.path, active });
}

export async function handleSetActiveResume(
  registry: Registry,
  args: SetActiveResumeArgs,
): Promise<Result<SetActiveResumeResult, ToolError>> {
  if (args.name === undefined) {
    const list = await registry.listResumes();
    if (!list.ok) return err(toToolError(list.error));
    const stateRead = await readState();
    const active =
      stateRead.ok && stateRead.value.activeResumeName !== undefined
        ? stateRead.value.activeResumeName
        : undefined;
    const registered = list.value.map((e) => e.name);
    return ok(active !== undefined ? { active, registered } : { registered });
  }
  const r = await registry.setActiveResume({ name: args.name });
  if (!r.ok) return err(toToolError(r.error));
  const list = await registry.listResumes();
  const registered = list.ok ? list.value.map((e) => e.name) : [args.name];
  return ok({ active: args.name, registered });
}

export async function handleFindMatchingJobs(
  config: JobDigestConfig,
  _args: FindMatchingJobsArgs,
): Promise<Result<FindMatchingJobsResult, ToolError>> {
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
  const ranked = await runPipeline(pool, config);
  const topK = ranked.slice(0, config.ranking.digestK);
  const date = todayIsoDate(new Date());
  const persisted = await persistDigest({
    date,
    generatedAt: new Date().toISOString(),
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
  return ok({ digestPath: persisted.value.path, jobs: topK, warnings });
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
    jobs: r.value.jobs,
    generatedAt: r.value.generatedAt,
  });
}

export async function handleGetJob(id: JobId): Promise<Result<GetJobResult, ToolError>> {
  const job = await findJobInLatestDigest(id);
  if (!job.ok) return err(job.error);
  return ok({ job: job.value });
}

export async function handleReadRules(
  config: JobDigestConfig,
  mode: ToolRulesMode,
): Promise<Result<ReadRulesResult, ToolError>> {
  const rules = await loadRulesByMode(mode, config.rules.userRulesDir, config.rules.mode);
  if (!rules.ok) return err(toToolError(rules.error));
  return ok(rulesToReadRulesResult(mode, rules.value));
}

export async function handleReadResume(
  registry: Registry,
): Promise<Result<ReadResumeResult, ToolError>> {
  const content = await registry.readResume({});
  if (!content.ok) return err(toToolError(content.error));
  const stateRead = await readState();
  const name =
    stateRead.ok && stateRead.value.activeResumeName !== undefined
      ? stateRead.value.activeResumeName
      : '';
  return ok({ name, content: content.value });
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

export async function handleStartApplication(
  args: StartApplicationArgs,
): Promise<Result<StartApplicationResult, ToolError>> {
  const job = await findJobInLatestDigest(args.jobId);
  if (!job.ok) return err(job.error);
  const date = todayIsoDate(new Date());
  const result = await coreStartApplication({
    jobId: args.jobId,
    company: job.value.company,
    role: job.value.title,
    date,
    ...(args.basedOnResumeName !== undefined
      ? { basedOnResumeName: args.basedOnResumeName }
      : {}),
  });
  if (!result.ok) return err(toToolError(result.error));
  return ok(
    args.basedOnResumeName !== undefined
      ? {
          path: result.value.dir,
          created: result.value.created,
          basedOnResumeName: args.basedOnResumeName,
        }
      : { path: result.value.dir, created: result.value.created },
  );
}

export async function handleWriteApplicationOutput(
  args: WriteApplicationOutputArgs,
): Promise<Result<WriteApplicationOutputResult, ToolError>> {
  const result = await coreWriteApplicationOutput({
    jobId: args.jobId,
    kind: args.kind,
    content: args.content,
  });
  if (!result.ok) return err(toToolError(result.error));
  return ok(
    result.value.version !== undefined
      ? { path: result.value.path, version: result.value.version }
      : { path: result.value.path },
  );
}

export async function handleListApplicationVersions(
  args: ListApplicationVersionsArgs,
): Promise<Result<ListApplicationVersionsResult, ToolError>> {
  const result = await coreListApplicationVersions(args.jobId, args.kind);
  if (!result.ok) return err(toToolError(result.error));
  const versions = result.value.map((v) => ({
    version: v.version,
    path: v.path,
    writtenAt: '',
  }));
  return ok({ versions });
}

export async function handleListRecentApplications(): Promise<
  Result<ListRecentApplicationsResult, ToolError>
> {
  const result = await coreListRecentApplications();
  if (!result.ok) return err(toToolError(result.error));
  const applications = result.value.map((a) => ({
    jobId: a.jobId,
    path: a.dir,
    company: a.company,
    role: a.role,
    startedAt: a.createdAt,
    ...(a.basedOnResumeName !== undefined
      ? { basedOnResumeName: a.basedOnResumeName }
      : {}),
  }));
  return ok({ applications });
}
