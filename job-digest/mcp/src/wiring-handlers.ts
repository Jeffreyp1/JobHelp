import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { JobDigestConfig } from '../../core/types/config.js';
import { err, ok, type Result } from '../../core/types/result.js';
import { applyConfigAnswers as coreApplyConfigAnswers, initConfig as coreInitConfig } from '../../core/init/index.js';
import type { Registry } from '../../core/resumes/registry.js';
import { readState } from '../../core/state/store.js';
import {
  startApplication as coreStartApplication, writeApplicationOutput as coreWriteApplicationOutput,
  listApplicationVersions as coreListApplicationVersions,
  listRecentApplications as coreListRecentApplications,
} from '../../core/applications/store.js';
import { slugify } from '../../core/applications/slugify.js';
import type {
  ApplyConfigAnswersArgs, ApplyConfigAnswersResult,
  InitConfigArgs, InitConfigResult, ListApplicationVersionsArgs, ListApplicationVersionsResult,
  ListRecentApplicationsResult, ReadResumeResult, ReadRulesResult, RegisterResumeArgs,
  RegisterResumeResult, RulesMode as ToolRulesMode,
  SetActiveResumeArgs, SetActiveResumeResult, StartApplicationArgs, StartApplicationResult,
  ToolError, WriteApplicationOutputArgs, WriteApplicationOutputResult,
} from './tools-types.js';
import { findJobInLatestDigest } from './wiring-handlers-job.js';
export {
  findJobInLatestDigest,
  handleFindMatchingJobs,
  handleGetJob,
  handleGetLatestDigest,
  handleScoreKeywordMatch,
} from './wiring-handlers-job.js';
export { handleValidateSources } from './wiring-handlers-validate.js';
export { handleRerankTopJobs } from './wiring-handlers-rerank.js';
import {
  getConfigPath, loadRulesByMode, rulesToReadRulesResult,
  todayIsoDate, toToolError,
} from './wiring-helpers.js';

export async function handleInitConfig(
  args: InitConfigArgs,
): Promise<Result<InitConfigResult, ToolError>> {
  const interactive = args.interactive !== false;
  const wizard = coreInitConfig({ interactive });
  if (!wizard.ok) return err({ type: 'invalid_input', message: wizard.error.message });
  return ok({
    created: false,
    path: getConfigPath(),
    nextStep: wizard.value.nextStep,
    prompts: wizard.value.prompts,
  });
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

function directJobIdentity(args: StartApplicationArgs): string {
  const source =
    args.url !== undefined && args.url.length > 0
      ? `url:${args.url}`
      : `jobDescription:${args.jobDescription ?? ''}`;
  return createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16);
}

export async function handleStartApplication(
  args: StartApplicationArgs,
): Promise<Result<StartApplicationResult, ToolError>> {
  const date = todayIsoDate(new Date());
  if (args.jobId === undefined) {
    if (args.company === undefined || args.role === undefined || args.jobDescription === undefined) {
      return err({
        type: 'invalid_input',
        message: 'jobId or company, role, and jobDescription are required',
      });
    }
    const jobId = `direct:${slugify(args.company)}:${slugify(args.role)}:${date}:${directJobIdentity(args)}`;
    const result = await coreStartApplication({
      jobId,
      company: args.company,
      role: args.role,
      date,
      jobDescription: args.jobDescription,
      ...(args.url !== undefined ? { url: args.url } : {}),
      ...(args.location !== undefined ? { location: args.location } : {}),
      ...(args.basedOnResumeName !== undefined
        ? { basedOnResumeName: args.basedOnResumeName }
        : {}),
    });
    if (!result.ok) return err(toToolError(result.error));
    return ok({
      jobId,
      path: result.value.dir,
      created: result.value.created,
      ...(args.basedOnResumeName !== undefined
        ? { basedOnResumeName: args.basedOnResumeName }
        : {}),
      ...(result.value.jobDescriptionPath !== undefined
        ? { jobDescriptionPath: result.value.jobDescriptionPath }
        : {}),
    });
  }

  const job = await findJobInLatestDigest(args.jobId);
  if (!job.ok) return err(job.error);
  const result = await coreStartApplication({
    jobId: args.jobId,
    company: job.value.company,
    role: job.value.title,
    date,
    url: job.value.url,
    location: job.value.location,
    ...(args.basedOnResumeName !== undefined
      ? { basedOnResumeName: args.basedOnResumeName }
      : {}),
  });
  if (!result.ok) return err(toToolError(result.error));
  return ok(
    args.basedOnResumeName !== undefined
      ? {
          jobId: args.jobId,
          path: result.value.dir,
          created: result.value.created,
          basedOnResumeName: args.basedOnResumeName,
        }
      : { jobId: args.jobId, path: result.value.dir, created: result.value.created },
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
      ? {
          path: result.value.path,
          applicationDir: result.value.applicationDir,
          fileName: result.value.fileName,
          kind: result.value.kind,
          latestPath: result.value.latestPath,
          version: result.value.version,
        }
      : {
          path: result.value.path,
          applicationDir: result.value.applicationDir,
          fileName: result.value.fileName,
          kind: result.value.kind,
          latestPath: result.value.latestPath,
        },
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
    writtenAt: v.writtenAt,
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
    ...(a.url !== undefined ? { url: a.url } : {}),
    ...(a.location !== undefined ? { location: a.location } : {}),
    ...(a.basedOnResumeName !== undefined
      ? { basedOnResumeName: a.basedOnResumeName }
      : {}),
  }));
  return ok({ applications });
}
