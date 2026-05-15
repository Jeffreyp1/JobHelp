#!/usr/bin/env node
import { buildServer, runStdio } from './index.js';
import type { CoreDeps, ToolError } from './tools.js';
import type { ResourceDeps, ResourceError } from './resources.js';
import type { Result } from '../../core/types/result.js';

const NOT_IMPLEMENTED: ToolError = {
  type: 'not_implemented',
  message: 'core dependency not yet wired; integration pending',
};

const RESOURCE_NOT_IMPLEMENTED: ResourceError = {
  type: 'internal',
  message: 'resource dependency not yet wired; integration pending',
};

function stubTool<T>(): Promise<Result<T, ToolError>> {
  return Promise.resolve({ ok: false, error: NOT_IMPLEMENTED });
}

function stubResource<T>(): Promise<Result<T, ResourceError>> {
  return Promise.resolve({ ok: false, error: RESOURCE_NOT_IMPLEMENTED });
}

const stubCoreDeps: CoreDeps = {
  initConfig: () => stubTool(),
  registerResume: () => stubTool(),
  setActiveResume: () => stubTool(),
  findMatchingJobs: () => stubTool(),
  getLatestDigest: () => stubTool(),
  getJob: () => stubTool(),
  readRules: () => stubTool(),
  readResume: () => stubTool(),
  scoreKeywordMatch: () => stubTool(),
  startApplication: () => stubTool(),
  writeApplicationOutput: () => stubTool(),
  listApplicationVersions: () => stubTool(),
  listRecentApplications: () => stubTool(),
};

const stubResourceDeps: ResourceDeps = {
  readRulesDefaults: () => stubResource(),
  readRulesUser: () => stubResource(),
  readRulesMerged: () => stubResource(),
  readActiveResume: () => stubResource(),
  readRecentDigest: () => stubResource(),
  readState: () => stubResource(),
};

async function main(): Promise<void> {
  const handle = buildServer({
    coreDeps: stubCoreDeps,
    resourceDeps: stubResourceDeps,
  });
  await runStdio(handle);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'unknown fatal error';
  process.stderr.write(`jobhelp-mcp: fatal: ${message}\n`);
  process.exit(1);
});
