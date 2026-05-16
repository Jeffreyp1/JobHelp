import { describe, expect, it } from 'vitest';
import { buildServer } from '../../mcp/src/index.js';
import type { CoreDeps, ToolError } from '../../mcp/src/tools.js';
import type { ResourceDeps, ResourceError, RuleFileContent } from '../../mcp/src/resources.js';
import {
  RECENT_DIGEST_URI,
  RESUME_URI,
  RULES_DEFAULTS_URI,
  RULES_MERGED_URI,
  RULES_USER_URI,
  STATE_URI,
} from '../../mcp/src/resources.js';
import type { Result } from '../../core/types/result.js';

function ok<T>(value: T): Result<T, ToolError> {
  return { ok: true, value };
}

function rok<T>(value: T): Result<T, ResourceError> {
  return { ok: true, value };
}

const rule = (n: string, c: string): RuleFileContent => ({ name: n, content: c });

function stubCoreDeps(): CoreDeps {
  return {
    initConfig: async () => ok({ created: true, path: '/x' }),
    applyConfigAnswers: async () => ok({ path: '/x' }),
    registerResume: async () => ok({ name: 'r', storedAt: '/x', active: true }),
    setActiveResume: async () => ok({ active: 'r', registered: ['r'] }),
    findMatchingJobs: async () => ok({ digestPath: '/x', jobs: [], warnings: [] }),
    getLatestDigest: async () => ok({ path: '/x', jobs: [], generatedAt: '2026' }),
    getJob: async () => ok({
      job: {
        id: 'a:1',
        source: 'a',
        url: 'http://x',
        title: 't',
        company: 'c',
        location: 'l',
        remote: 'remote',
        description: 'd',
      },
    }),
    readRules: async () => ok({ mode: 'merged', files: [] }),
    readResume: async () => ok({ name: 'r', content: '#' }),
    scoreKeywordMatch: async () => ok({ score: 1, matched: [], missing: [] }),
    startApplication: async () => ok({ path: '/x', created: true }),
    writeApplicationOutput: async () => ok({ path: '/x', version: 1 }),
    listApplicationVersions: async () => ok({ versions: [] }),
    listRecentApplications: async () => ok({ applications: [] }),
  };
}

function stubResourceDeps(): ResourceDeps {
  return {
    readRulesDefaults: async () => rok([rule('a.md', 'a')]),
    readRulesUser: async () => rok([]),
    readRulesMerged: async () => rok([rule('a.md', 'a')]),
    readActiveResume: async () => rok({ name: 'r', content: '#' }),
    readRecentDigest: async () => rok({}),
    readState: async () => rok({}),
  };
}

describe('buildServer', () => {
  it('returns a ServerHandle with tools and resources', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    expect(handle.server).toBeDefined();
    expect(handle.tools.length).toBe(14);
    expect(handle.resources.length).toBe(6);
  });

  it('registers a stable set of tool names', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    const names = handle.tools.map((t) => t.definition.name);
    expect(names).toContain('init_config');
    expect(names).toContain('find_matching_jobs');
    expect(names).toContain('write_application_output');
  });

  it('registers a stable set of resource URIs', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    const uris = handle.resources.map((r) => r.descriptor.uri).sort();
    expect(uris).toEqual(
      [
        RECENT_DIGEST_URI,
        RESUME_URI,
        RULES_DEFAULTS_URI,
        RULES_MERGED_URI,
        RULES_USER_URI,
        STATE_URI,
      ].sort(),
    );
  });

  it('accepts custom name and version', () => {
    const handle = buildServer({
      name: 'custom',
      version: '9.9.9',
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    expect(handle.server).toBeDefined();
  });

  it('uses defaults when name/version omitted', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    expect(handle.server).toBeDefined();
  });
});
