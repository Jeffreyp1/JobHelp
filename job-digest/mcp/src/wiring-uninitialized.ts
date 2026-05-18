import { applyConfigAnswers as coreApplyConfigAnswers, initConfig as coreInitConfig } from '../../core/init/index.js';
import { err, ok, type Result } from '../../core/types/result.js';
import type { ConfigError } from '../../core/lib/config.js';
import type {
  ApplyConfigAnswersArgs,
  ApplyConfigAnswersResult,
  CoreDeps,
  InitConfigArgs,
  InitConfigResult,
  ToolError,
} from './tools-types.js';
import type { ResourceDeps } from './resources.js';
import {
  getConfigPath,
  notConfiguredResource,
  notConfiguredTool,
  toToolError,
} from './wiring-helpers.js';

async function handleInit(
  args: InitConfigArgs,
  loadErr: ConfigError,
): Promise<Result<InitConfigResult, ToolError>> {
  const interactive = args.interactive !== false;
  const wizard = coreInitConfig({ interactive });
  if (!wizard.ok) {
    return err({ type: 'invalid_input', message: wizard.error.message });
  }
  return ok({ created: false, path: loadErr.path ?? getConfigPath() });
}

async function handleApply(
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

export function uninitializedCoreDeps(loadErr: ConfigError): CoreDeps {
  const notConfigured = notConfiguredTool();
  return {
    initConfig: (args) => handleInit(args, loadErr),
    applyConfigAnswers: handleApply,
    registerResume: async () => err(notConfigured),
    setActiveResume: async () => err(notConfigured),
    findMatchingJobs: async () => err(notConfigured),
    getLatestDigest: async () => err(notConfigured),
    getJob: async () => err(notConfigured),
    readRules: async () => err(notConfigured),
    readResume: async () => err(notConfigured),
    scoreKeywordMatch: async () => err(notConfigured),
    startApplication: async () => err(notConfigured),
    writeApplicationOutput: async () => err(notConfigured),
    listApplicationVersions: async () => err(notConfigured),
    listRecentApplications: async () => err(notConfigured),
    validateSources: async () => err(notConfigured),
    rerankTopJobs: async () => err(notConfigured),
  };
}

export function uninitializedResourceDeps(): ResourceDeps {
  const notConfigured = notConfiguredResource();
  return {
    readRulesDefaults: async () => err(notConfigured),
    readRulesUser: async () => err(notConfigured),
    readRulesMerged: async () => err(notConfigured),
    readActiveResume: async () => err(notConfigured),
    readRecentDigest: async () => err(notConfigured),
    readState: async () => err(notConfigured),
  };
}
