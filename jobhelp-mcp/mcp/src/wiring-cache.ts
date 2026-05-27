import { stat } from 'node:fs/promises';
import type { JobDigestConfig } from '../../core/types/config.js';
import { loadConfig, type ConfigError } from '../../core/lib/config.js';
import { createRegistry, type Registry } from '../../core/resumes/registry.js';
import { defaultCompanySourcesPath } from '../../core/init/companySources.js';
import type { CoreDeps } from './tools-types.js';
import type { ResourceDeps } from './resources.js';
import { getConfigPath, getResumesDir } from './wiring-helpers.js';
import { createResumeStateAdapter } from './wiring-state-adapter.js';

export type DepsResolution =
  | {
      readonly kind: 'ready';
      readonly config: JobDigestConfig;
      readonly registry: Registry;
    }
  | {
      readonly kind: 'uninitialized';
      readonly error: ConfigError;
    };

interface CachedReady {
  readonly configMtimeMs: number | null;
  readonly companySourcesMtimeMs: number | null;
  readonly resolution: Extract<DepsResolution, { kind: 'ready' }>;
}

interface DepsResolverState {
  cached: CachedReady | null;
}

async function getMtimeMs(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

export function createDepsResolver(): () => Promise<DepsResolution> {
  const state: DepsResolverState = { cached: null };
  return async (): Promise<DepsResolution> => {
    const configPath = getConfigPath();
    const configMtimeMs = await getMtimeMs(configPath);
    const companySourcesMtimeMs = await getMtimeMs(defaultCompanySourcesPath(configPath));
    if (
      state.cached !== null &&
      state.cached.configMtimeMs === configMtimeMs &&
      state.cached.companySourcesMtimeMs === companySourcesMtimeMs &&
      configMtimeMs !== null
    ) {
      return state.cached.resolution;
    }
    const loaded = await loadConfig(configPath);
    if (!loaded.ok) {
      state.cached = null;
      return { kind: 'uninitialized', error: loaded.error };
    }
    const stateStore = createResumeStateAdapter();
    const registry = createRegistry({
      store: stateStore,
      resumesDir: getResumesDir(),
    });
    const resolution: Extract<DepsResolution, { kind: 'ready' }> = {
      kind: 'ready',
      config: loaded.value,
      registry,
    };
    state.cached = { configMtimeMs, companySourcesMtimeMs, resolution };
    return resolution;
  };
}

export interface LazyDeps {
  readonly coreDeps: CoreDeps;
  readonly resourceDeps: ResourceDeps;
}

export interface LazyDepsFactory {
  readonly resolve: () => Promise<DepsResolution>;
  readonly buildReady: (config: JobDigestConfig, registry: Registry) => LazyDeps;
  readonly buildUninitialized: (error: ConfigError) => LazyDeps;
}

export function createLazyCoreDeps(factory: LazyDepsFactory): CoreDeps {
  async function pick<K extends keyof CoreDeps>(key: K): Promise<CoreDeps[K]> {
    const resolution = await factory.resolve();
    const deps =
      resolution.kind === 'ready'
        ? factory.buildReady(resolution.config, resolution.registry).coreDeps
        : factory.buildUninitialized(resolution.error).coreDeps;
    return deps[key];
  }
  return {
    initConfig: async (args) => (await pick('initConfig'))(args),
    applyConfigAnswers: async (args) => (await pick('applyConfigAnswers'))(args),
    registerResume: async (args) => (await pick('registerResume'))(args),
    setActiveResume: async (args) => (await pick('setActiveResume'))(args),
    findMatchingJobs: async (args) => (await pick('findMatchingJobs'))(args),
    getLatestDigest: async () => (await pick('getLatestDigest'))(),
    getJob: async (id) => (await pick('getJob'))(id),
    readRules: async (mode) => (await pick('readRules'))(mode),
    readResume: async () => (await pick('readResume'))(),
    scoreKeywordMatch: async (args) => (await pick('scoreKeywordMatch'))(args),
    startApplication: async (args) => (await pick('startApplication'))(args),
    writeApplicationOutput: async (args) => (await pick('writeApplicationOutput'))(args),
    listApplicationVersions: async (args) => (await pick('listApplicationVersions'))(args),
    listRecentApplications: async () => (await pick('listRecentApplications'))(),
    validateSources: async (args) => (await pick('validateSources'))(args),
    rerankTopJobs: async (args) => (await pick('rerankTopJobs'))(args),
  };
}

export function createLazyResourceDeps(factory: LazyDepsFactory): ResourceDeps {
  async function pick<K extends keyof ResourceDeps>(key: K): Promise<ResourceDeps[K]> {
    const resolution = await factory.resolve();
    const deps =
      resolution.kind === 'ready'
        ? factory.buildReady(resolution.config, resolution.registry).resourceDeps
        : factory.buildUninitialized(resolution.error).resourceDeps;
    return deps[key];
  }
  return {
    readRulesDefaults: async () => (await pick('readRulesDefaults'))(),
    readRulesUser: async () => (await pick('readRulesUser'))(),
    readRulesMerged: async () => (await pick('readRulesMerged'))(),
    readActiveResume: async () => (await pick('readActiveResume'))(),
    readRecentDigest: async () => (await pick('readRecentDigest'))(),
    readState: async () => (await pick('readState'))(),
  };
}
