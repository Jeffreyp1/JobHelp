import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../mcp/src/index.js';
import type { CoreDeps, ToolError } from '../../mcp/src/tools.js';
import type { ResourceDeps, ResourceError, RuleFileContent } from '../../mcp/src/resources.js';
import {
  PROMPT_TAILOR_RESUME_URI,
  PROMPT_TAILOR_RESUMES_URI,
  PROMPT_VALIDATE_RESUME_URI,
  PROMPT_JOB_DIGEST_TAILOR_URI,
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
    findMatchingJobs: async () =>
      ok({ digestPath: '/x', jobs: [], warnings: [], nextRequiredStep: 'rerank' }),
    getLatestDigest: async () =>
      ok({ path: '/x', jobs: [], totalPersisted: 0, generatedAt: '2026', nextRequiredStep: 'rerank' }),
    getTriageList: async () =>
      ok({
        total: 0,
        returned: 0,
        truncated: false,
        triage: { model: 'sonnet', chunkSize: 150 },
        profileCard: 'profile',
        lines: [],
        nextRequiredStep: 'triage',
      }),
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
    analyzeFit: async () => ok({ matched: [], missing: [], matchedCount: 0, jobSkillCount: 0 }),
    startApplication: async () => ok({ path: '/x', created: true }),
    writeApplicationOutput: async () => ok({ path: '/x', version: 1 }),
    listApplicationVersions: async () => ok({ versions: [] }),
    listRecentApplications: async () => ok({ applications: [] }),
    recordJobVerdicts: async () => ok({ recorded: 0, unresolvedIds: [] }),
    validateSources: async () => ok({ results: [], summary: { total: 0, ok: 0, failed: 0 } }),
    rerankTopJobs: async () =>
      ok({
        jobs: [],
        resume: { name: 'r', content: '#' },
        rerank_prompt: 'p',
        summary: {
          topK: 0,
          resumeChars: 1,
          totalJDBytes: 0,
          digestDate: '2026',
          digestPath: '/x',
        },
      }),
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
    expect(handle.tools.length).toBe(24);
    expect(handle.resources.length).toBe(10);
    expect(handle.prompts.length).toBe(4);
  });

  it('registers a stable set of tool names', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    const names = handle.tools.map((t) => t.definition.name);
    expect(names).toContain('init_config');
    expect(names).toContain('find_matching_jobs');
    expect(names).toContain('prepare_batch_applications');
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
        PROMPT_TAILOR_RESUME_URI,
        PROMPT_TAILOR_RESUMES_URI,
        PROMPT_VALIDATE_RESUME_URI,
        PROMPT_JOB_DIGEST_TAILOR_URI,
        RESUME_URI,
        RULES_DEFAULTS_URI,
        RULES_MERGED_URI,
        RULES_USER_URI,
        STATE_URI,
      ].sort(),
    );
  });

  it('registers a stable set of prompt names', () => {
    const handle = buildServer({
      coreDeps: stubCoreDeps(),
      resourceDeps: stubResourceDeps(),
    });
    const names = handle.prompts.map((p) => p.definition.name).sort();
    expect(names).toEqual(['job_digest_tailor', 'tailor_resume', 'tailor_resumes', 'validate_resume']);
  });

  it('serves prompts through the MCP list/get handlers', async () => {
    await withClient(async (client) => {
      expect(client.getServerCapabilities()?.prompts).toEqual({});
      const listed = await client.listPrompts();
      expect(listed.prompts.map((p) => p.name).sort()).toEqual([
        'job_digest_tailor',
        'tailor_resume',
        'tailor_resumes',
        'validate_resume',
      ]);

      const prompt = await client.getPrompt({
        name: 'tailor_resumes',
        arguments: { input: 'top 2 jobs' },
      });
      const first = prompt.messages[0];
      if (first?.content.type !== 'text') throw new Error('missing text prompt');
      expect(first.content.text).toContain('top 2 jobs');
      expect(first.content.text).toContain('validate_resume');
    });
  });

  it('rejects unknown prompts through the MCP get handler', async () => {
    await withClient(async (client) => {
      await expect(client.getPrompt({ name: 'missing_prompt' })).rejects.toThrow(
        /unknown prompt: missing_prompt/,
      );
    });
  });

  it('does not expose resume prompts as tools', async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name);
      expect(names).not.toContain('tailor_resumes');
      expect(names).not.toContain('tailor_resume');
      expect(names).not.toContain('validate_resume');
    });
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

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const handle = buildServer({
    coreDeps: stubCoreDeps(),
    resourceDeps: stubResourceDeps(),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {}, enforceStrictCapabilities: true },
  );
  await Promise.all([client.connect(clientTransport), handle.server.connect(serverTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await handle.server.close();
  }
}
