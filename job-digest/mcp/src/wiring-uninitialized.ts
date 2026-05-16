import { initConfig as coreInitConfig } from '../../core/init/index.js';
import { err, ok, type Result } from '../../core/types/result.js';
import type { ConfigError } from '../../core/lib/config.js';
import type {
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

export function uninitializedCoreDeps(loadErr: ConfigError): CoreDeps {
  const notConfigured = notConfiguredTool();
  return {
    initConfig: (args) => handleInit(args, loadErr),
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
