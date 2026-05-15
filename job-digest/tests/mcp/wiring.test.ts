import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import type { ToolHandler } from '../../mcp/src/tools.js';
import type { ResourceHandler } from '../../mcp/src/resources.js';

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
});
