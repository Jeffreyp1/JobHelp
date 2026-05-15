import type { JobDigestConfig } from '../../core/types/config.js';
import { err, ok, type Result } from '../../core/types/result.js';
import { loadConfig } from '../../core/lib/config.js';
import { createRegistry, type Registry } from '../../core/resumes/registry.js';
import { readState } from '../../core/state/store.js';
import { getLatestDigest } from '../../core/state/digestStore.js';
import { loadDefaults, loadUserRules } from '../../core/rules/loader.js';
import { merge } from '../../core/rules/merger.js';
import type { CoreDeps } from './tools-types.js';
import type { ResourceDeps, ResourceError, RuleFileContent } from './resources.js';
import {
  getConfigPath,
  getResumesDir,
  rulesToRuleFileContent,
  toResourceError,
} from './wiring-helpers.js';
import { createResumeStateAdapter } from './wiring-state-adapter.js';
import {
  uninitializedCoreDeps,
  uninitializedResourceDeps,
} from './wiring-uninitialized.js';
import {
  handleFindMatchingJobs,
  handleGetJob,
  handleGetLatestDigest,
  handleInitConfig,
  handleListApplicationVersions,
  handleListRecentApplications,
  handleReadResume,
  handleReadRules,
  handleRegisterResume,
  handleScoreKeywordMatch,
  handleSetActiveResume,
  handleStartApplication,
  handleWriteApplicationOutput,
} from './wiring-handlers.js';

export interface BootstrapResult {
  readonly coreDeps: CoreDeps;
  readonly resourceDeps: ResourceDeps;
}

interface BuildOpts {
  readonly config: JobDigestConfig;
  readonly registry: Registry;
}

export function buildCoreDeps(opts: BuildOpts): CoreDeps {
  const { config, registry } = opts;
  return {
    initConfig: handleInitConfig,
    registerResume: (args) => handleRegisterResume(registry, args),
    setActiveResume: (args) => handleSetActiveResume(registry, args),
    findMatchingJobs: (args) => handleFindMatchingJobs(config, args),
    getLatestDigest: handleGetLatestDigest,
    getJob: handleGetJob,
    readRules: (mode) => handleReadRules(config, mode),
    readResume: () => handleReadResume(registry),
    scoreKeywordMatch: handleScoreKeywordMatch,
    startApplication: handleStartApplication,
    writeApplicationOutput: handleWriteApplicationOutput,
    listApplicationVersions: handleListApplicationVersions,
    listRecentApplications: handleListRecentApplications,
  };
}

export function buildResourceDeps(opts: BuildOpts): ResourceDeps {
  const { config, registry } = opts;
  return {
    readRulesDefaults: async (): Promise<Result<readonly RuleFileContent[], ResourceError>> => {
      const r = await loadDefaults();
      if (!r.ok) return err(toResourceError(r.error));
      return ok(rulesToRuleFileContent(r.value));
    },
    readRulesUser: async (): Promise<Result<readonly RuleFileContent[], ResourceError>> => {
      const r = await loadUserRules(config.rules.userRulesDir);
      if (!r.ok) return err(toResourceError(r.error));
      return ok(rulesToRuleFileContent(r.value));
    },
    readRulesMerged: async (): Promise<Result<readonly RuleFileContent[], ResourceError>> => {
      const defaults = await loadDefaults();
      if (!defaults.ok) return err(toResourceError(defaults.error));
      const user = await loadUserRules(config.rules.userRulesDir);
      if (!user.ok) return err(toResourceError(user.error));
      const merged = merge(defaults.value, user.value, config.rules.mode);
      return ok(rulesToRuleFileContent(merged));
    },
    readActiveResume: async (): Promise<
      Result<{ readonly name: string; readonly content: string }, ResourceError>
    > => {
      const content = await registry.readResume({});
      if (!content.ok) return err(toResourceError(content.error));
      const stateRead = await readState();
      const name =
        stateRead.ok && stateRead.value.activeResumeName !== undefined
          ? stateRead.value.activeResumeName
          : '';
      return ok({ name, content: content.value });
    },
    readRecentDigest: async (): Promise<Result<unknown, ResourceError>> => {
      const r = await getLatestDigest();
      if (!r.ok) return err(toResourceError(r.error));
      return ok(r.value);
    },
    readState: async (): Promise<Result<unknown, ResourceError>> => {
      const r = await readState();
      if (!r.ok) return err(toResourceError(r.error));
      return ok(r.value);
    },
  };
}

export async function bootstrap(): Promise<BootstrapResult> {
  const configPath = getConfigPath();
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) {
    return {
      coreDeps: uninitializedCoreDeps(loaded.error),
      resourceDeps: uninitializedResourceDeps(),
    };
  }
  const stateStore = createResumeStateAdapter();
  const registry = createRegistry({
    store: stateStore,
    resumesDir: getResumesDir(),
  });
  return {
    coreDeps: buildCoreDeps({ config: loaded.value, registry }),
    resourceDeps: buildResourceDeps({ config: loaded.value, registry }),
  };
}
