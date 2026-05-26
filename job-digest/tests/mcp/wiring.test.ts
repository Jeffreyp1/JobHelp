import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import { handleFindMatchingJobs } from '../../mcp/src/wiring-handlers.js';
import { ALL_ADAPTERS } from '../../core/sources/index.js';
import { getLatestDigest, persistDigest } from '../../core/state/digestStore.js';
import type { ToolHandler } from '../../mcp/src/tools.js';
import type { ResourceHandler } from '../../mcp/src/resources.js';
import type { JobDigestConfig, SourceAdapter } from '../../core/types/index.js';

interface ParsedToolBody {
  readonly ok: boolean;
  readonly value?: Record<string, unknown>;
  readonly error?: { readonly type: string; readonly message: string };
}

function parseToolBody(content: readonly { text: string }[]): ParsedToolBody {
  if (content.length !== 1) throw new Error('expected single content item');
  const first = content[0];
  if (first === undefined) throw new Error('empty content');
  return JSON.parse(first.text) as ParsedToolBody;
}

function findTool(handlers: readonly ToolHandler[], name: string): ToolHandler {
  const h = handlers.find((t) => t.definition.name === name);
  if (h === undefined) throw new Error(`tool not found: ${name}`);
  return h;
}

function findResource(handlers: readonly ResourceHandler[], uri: string): ResourceHandler {
  const h = handlers.find((r) => r.descriptor.uri === uri);
  if (h === undefined) throw new Error(`resource not found: ${uri}`);
  return h;
}

function writeMinimalConfig(dir: string): string {
  const configDir = join(dir, '.config', 'jobhelp');
  mkdirSync(configDir, { recursive: true });
  const p = join(configDir, 'config.json');
  writeFileSync(
    p,
    JSON.stringify({
      profile: {
        resumeDumpPath: join(dir, 'resume.md'),
        skills: ['typescript', 'go'],
        location: 'Remote',
        remoteOk: true,
        salaryFloor: 100000,
        seniority: 'mid',
        roleFamily: ['backend'],
      },
      ranking: { topN: 5, digestK: 5 },
      output: { dir: join(dir, 'digests') },
      rules: { mode: 'additive', userRulesDir: join(dir, 'rules') },
    }),
  );
  return p;
}

function makeJobConfig(dir: string): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: join(dir, 'resume.md'),
      skills: ['typescript', 'go'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 0,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: {
      topN: 10,
      digestK: 5,
      maxAge: { enabled: false, days: 30, requireDate: false },
      recency: { enabled: false, halfLifeDays: 14 },
    },
    output: { dir: join(dir, 'digests') },
    rules: { mode: 'additive', userRulesDir: join(dir, 'rules') },
  };
}

describe('mcp/wiring e2e — boot real server with temp JOBHELP_HOME', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevConfigPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-e2e-'));
    prevHome = process.env['JOBHELP_HOME'];
    prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
    process.env['JOBHELP_HOME'] = tmp;
    process.env['JOBHELP_CONFIG_PATH'] = writeMinimalConfig(tmp);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
    else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('init_config (interactive) returns wizard ask_user path', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'init_config');
    const response = await tool.invoke({ interactive: true });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
  });

  it('register_resume + read_resume round-trip', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const reg = findTool(handle.tools, 'register_resume');
    const regResponse = await reg.invoke({ name: 'backend', content: '# backend resume\n\nTypeScript and Go.\n' });
    const regBody = parseToolBody(regResponse.content);
    expect(regBody.ok).toBe(true);
    expect(regBody.value?.['name']).toBe('backend');

    const read = findTool(handle.tools, 'read_resume');
    const readResponse = await read.invoke({});
    const readBody = parseToolBody(readResponse.content);
    expect(readBody.ok).toBe(true);
    const readValue = readBody.value;
    if (readValue === undefined) throw new Error('expected value');
    expect(readValue['name']).toBe('backend');
    expect(typeof readValue['content']).toBe('string');
    expect((readValue['content'] as string).includes('TypeScript')).toBe(true);
  });

  it('read_rules merged mode returns rule files from bundle', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const read = findTool(handle.tools, 'read_rules');
    const response = await read.invoke({ mode: 'merged' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['mode']).toBe('merged');
    expect(Array.isArray(body.value?.['files'])).toBe(true);
  });

  it('set_active_resume with no name returns the registered list', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const reg = findTool(handle.tools, 'register_resume');
    await reg.invoke({ name: 'first', content: '# first' });
    await reg.invoke({ name: 'second', content: '# second' });
    const setActive = findTool(handle.tools, 'set_active_resume');
    const response = await setActive.invoke({});
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    const registered = body.value?.['registered'];
    expect(Array.isArray(registered)).toBe(true);
    expect((registered as string[]).sort()).toEqual(['first', 'second']);
  });

  it('set_active_resume(name) switches active resume', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const reg = findTool(handle.tools, 'register_resume');
    await reg.invoke({ name: 'first', content: '# first' });
    await reg.invoke({ name: 'second', content: '# second' });
    const setActive = findTool(handle.tools, 'set_active_resume');
    const response = await setActive.invoke({ name: 'second' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['active']).toBe('second');
  });

  it('get_latest_digest returns not_found when no digest has been generated', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'get_latest_digest');
    const response = await tool.invoke({});
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe('not_found');
  });

  it('find_matching_jobs honors count as the returned and persisted top-N', async () => {
    const originalAdapters = [...ALL_ADAPTERS];
    const mutableAdapters = ALL_ADAPTERS as unknown as SourceAdapter[];
    mutableAdapters.length = 0;
    mutableAdapters.push({
      name: 'fixture',
      enabled: () => true,
      fetch: async () => [
        {
          id: 'fixture:1',
          source: 'fixture',
          url: 'https://example.test/1',
          title: 'Backend TypeScript Engineer',
          company: 'One',
          location: 'Remote',
          remote: 'remote',
          description:
            'TypeScript Go backend services for high-volume APIs, distributed systems, observability, database migrations, deployment automation, incident response, and developer experience. The role partners with product teams and ships reliable backend platform features.',
        },
        {
          id: 'fixture:2',
          source: 'fixture',
          url: 'https://example.test/2',
          title: 'Backend Go Engineer',
          company: 'Two',
          location: 'Remote',
          remote: 'remote',
          description:
            'Go TypeScript backend services for high-volume APIs, distributed systems, observability, database migrations, deployment automation, incident response, and developer experience. The role partners with product teams and ships reliable backend platform features.',
        },
        {
          id: 'fixture:3',
          source: 'fixture',
          url: 'https://example.test/3',
          title: 'Frontend Engineer',
          company: 'Three',
          location: 'Remote',
          remote: 'remote',
          description:
            'React UI work on production interfaces, accessibility, component systems, design systems, browser performance, product analytics, and collaboration with backend teams. The role ships polished user experiences across multiple surfaces.',
        },
      ],
    });
    try {
      const result = await handleFindMatchingJobs(makeJobConfig(tmp), { count: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jobs).toHaveLength(2);
      const latest = await getLatestDigest();
      expect(latest.ok).toBe(true);
      if (latest.ok) expect(latest.value.jobs).toHaveLength(2);
    } finally {
      mutableAdapters.length = 0;
      mutableAdapters.push(...originalAdapters);
    }
  });

  it('doctor reports setup checks without mutating state', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'doctor');
    const response = await tool.invoke({});
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    const value = body.value;
    if (value === undefined) throw new Error('expected value');
    expect(value['ready']).toBe(false);
    const checks = value['checks'];
    expect(Array.isArray(checks)).toBe(true);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'config', ok: true, path: process.env['JOBHELP_CONFIG_PATH'] }),
        expect.objectContaining({ name: 'sources', ok: false }),
        expect.objectContaining({ name: 'active_resume', ok: false }),
        expect.objectContaining({ name: 'latest_digest', ok: false }),
      ]),
    );
    const stateResource = findResource(handle.resources, 'jobhelp://state');
    const state = await stateResource.read();
    const parsed = JSON.parse(state.contents[0]?.text ?? '{}') as {
      resumes?: unknown[];
      applications?: unknown[];
    };
    expect(parsed.resumes).toEqual([]);
    expect(parsed.applications).toEqual([]);
  });

  it('list_recent_applications returns empty list before any application', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'list_recent_applications');
    const response = await tool.invoke({});
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['applications']).toEqual([]);
  });

  it('resource jobhelp://state returns valid state shape', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const resource = findResource(handle.resources, 'jobhelp://state');
    const response = await resource.read();
    expect(response.isError).not.toBe(true);
    const text = response.contents[0]?.text;
    if (text === undefined) throw new Error('expected content');
    const parsed = JSON.parse(text) as { resumes?: unknown; applications?: unknown };
    expect(Array.isArray(parsed.resumes)).toBe(true);
    expect(Array.isArray(parsed.applications)).toBe(true);
  });

  it('resource jobhelp://rules/defaults returns bundled rules content', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const resource = findResource(handle.resources, 'jobhelp://rules/defaults');
    const response = await resource.read();
    expect(response.isError).not.toBe(true);
    const text = response.contents[0]?.text;
    expect(typeof text).toBe('string');
    expect((text ?? '').length).toBeGreaterThan(0);
  });

  it('register_resume from path reads file and registers', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const resumePath = join(tmp, 'from-file.md');
    writeFileSync(resumePath, '# from file\nTypeScript skills.\n');
    const reg = findTool(handle.tools, 'register_resume');
    const response = await reg.invoke({ name: 'from-file', path: resumePath });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['name']).toBe('from-file');
  });

  it('get_job for unknown id returns not_found (no digest yet)', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'get_job');
    const response = await tool.invoke({ id: 'adzuna:nope' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe('not_found');
  });

  it('write_application_output without start returns not_found', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'write_application_output');
    const response = await tool.invoke({ jobId: 'unknown:1', kind: 'resume', content: 'x' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe('not_found');
  });

  it('start_application works for a job in the latest digest', async () => {
    const persisted = await persistDigest({
      date: '2026-05-15',
      generatedAt: '2026-05-15T00:00:00.000Z',
      totalDurationMs: 0,
      sourceResults: [{ source: 'fixture', jobCount: 1, durationMs: 0 }],
      jobs: [
        {
          rank: 1,
          score: 0.9,
          breakdown: { keywordOverlap: 0.9, recencyBoost: 1, bm25f: 2 },
          job: {
            id: 'fixture:1',
            source: 'fixture',
            url: 'https://example.test/jobs/1',
            title: 'Backend Engineer',
            company: 'Acme',
            location: 'Remote',
            remote: 'remote',
            description: 'Build APIs.',
          },
        },
      ],
    });
    if (!persisted.ok) throw new Error(persisted.error.message);

    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'start_application');
    const response = await tool.invoke({ jobId: 'fixture:1', basedOnResumeName: 'backend' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['jobId']).toBe('fixture:1');
    expect(body.value?.['created']).toBe(true);
    expect(typeof body.value?.['path']).toBe('string');
  });

  it('start_application works from pasted job metadata without a digest match', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const start = findTool(handle.tools, 'start_application');
    const startResponse = await start.invoke({
      company: 'No Digest Co',
      role: 'Platform Engineer',
      jobDescription: 'Own platform reliability.',
      url: 'https://example.test/direct',
    });
    const startBody = parseToolBody(startResponse.content);
    expect(startBody.ok).toBe(true);
    const jobId = startBody.value?.['jobId'];
    expect(typeof jobId).toBe('string');
    expect((jobId as string).startsWith('direct:')).toBe(true);
    expect(typeof startBody.value?.['jobDescriptionPath']).toBe('string');

    const write = findTool(handle.tools, 'write_application_output');
    const writeResponse = await write.invoke({
      jobId,
      kind: 'resume',
      content: '# Tailored Resume\n',
    });
    const writeBody = parseToolBody(writeResponse.content);
    expect(writeBody.ok).toBe(true);
    expect(writeBody.value).toMatchObject({
      fileName: 'resume.v1.md',
      kind: 'resume',
      version: 1,
      latestPath: writeBody.value?.['path'],
    });
  });

  it('list_application_versions preserves writtenAt after writing output', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const start = findTool(handle.tools, 'start_application');
    const startResponse = await start.invoke({
      company: 'Version Co',
      role: 'Backend Engineer',
      jobDescription: 'Build APIs.',
    });
    const startBody = parseToolBody(startResponse.content);
    const jobId = startBody.value?.['jobId'];
    const write = findTool(handle.tools, 'write_application_output');
    await write.invoke({ jobId, kind: 'resume', content: '# Resume\n' });

    const list = findTool(handle.tools, 'list_application_versions');
    const listResponse = await list.invoke({ jobId, kind: 'resume' });
    const listBody = parseToolBody(listResponse.content);
    expect(listBody.ok).toBe(true);
    const versions = listBody.value?.['versions'] as Array<{ writtenAt?: string }> | undefined;
    expect(versions?.[0]?.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('mcp/wiring lazy re-bootstrap — config written after boot', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevConfigPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-lazy-'));
    prevHome = process.env['JOBHELP_HOME'];
    prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
    process.env['JOBHELP_HOME'] = tmp;
    process.env['JOBHELP_CONFIG_PATH'] = join(tmp, '.config', 'jobhelp', 'config.json');
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
    else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('tool returns not_configured before config exists, then real result after config is written', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const listRecent = findTool(handle.tools, 'list_recent_applications');

    const before = await listRecent.invoke({});
    const beforeBody = parseToolBody(before.content);
    expect(beforeBody.ok).toBe(false);
    expect(beforeBody.error?.type).toBe('not_configured');

    writeMinimalConfig(tmp);

    const after = await listRecent.invoke({});
    const afterBody = parseToolBody(after.content);
    expect(afterBody.ok).toBe(true);
    expect(afterBody.value?.['applications']).toEqual([]);
  });

  it('init_config returns wizard prompts while config is missing', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const init = findTool(handle.tools, 'init_config');
    const response = await init.invoke({ interactive: true });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['path']).toBe(process.env['JOBHELP_CONFIG_PATH']);
    expect(body.value?.['nextStep']).toBe('ask_user');
    const prompts = body.value?.['prompts'];
    expect(Array.isArray(prompts)).toBe(true);
    expect((prompts as Array<{ key: string }>).map((p) => p.key)).toContain('profile.resumeDumpPath');
  });

  it('resource returns not_configured before config, then real content after config is written', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const stateResource = findResource(handle.resources, 'jobhelp://state');

    const before = await stateResource.read();
    expect(before.isError).toBe(true);

    writeMinimalConfig(tmp);

    const after = await stateResource.read();
    expect(after.isError).not.toBe(true);
    const text = after.contents[0]?.text;
    if (text === undefined) throw new Error('expected content');
    const parsed = JSON.parse(text) as { resumes?: unknown; applications?: unknown };
    expect(Array.isArray(parsed.resumes)).toBe(true);
  });

  it('init_config works even when no config exists (uninitialized branch)', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'init_config');
    const response = await tool.invoke({ interactive: true });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
  });

  it('doctor reports missing config before setup', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const tool = findTool(handle.tools, 'doctor');
    const response = await tool.invoke({});
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['ready']).toBe(false);
    expect(body.value?.['checks']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'config',
          ok: false,
          nextStep: expect.stringContaining('init_config'),
        }),
      ]),
    );
  });
});
