import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import { findResource, findTool, parseToolBody, writeMinimalConfig } from './_wiring-fixtures.js';

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
