import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolError } from '../../mcp/src/tools.js';
import { createTools } from '../../mcp/src/tools.js';
import { fail, getTool, makeDeps, ok, parseResponseBody } from './_fixtures.js';

describe('start_application', () => {
  it('requires jobId', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
  });

  it('forwards jobId and basedOnResumeName', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    await tool.invoke({ jobId: 'a:1', basedOnResumeName: 'backend' });
    expect(calls.startApplication).toEqual([{ jobId: 'a:1', basedOnResumeName: 'backend' }]);
  });

  it('forwards pasted job metadata without requiring jobId', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    await tool.invoke({
      company: 'Acme',
      role: 'Backend Engineer',
      jobDescription: 'Build APIs.',
      url: 'https://example.test/jobs/1',
      basedOnResumeName: 'backend',
    });
    expect(calls.startApplication).toEqual([
      {
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs.',
        url: 'https://example.test/jobs/1',
        basedOnResumeName: 'backend',
      },
    ]);
  });

  it('rejects partial pasted job metadata', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    const res = await tool.invoke({ company: 'Acme', jobDescription: 'Build APIs.' });
    expect(res.isError).toBe(true);
  });
});

describe('write_application_output', () => {
  it('validates kind enum', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    const res = await tool.invoke({ jobId: 'a:1', kind: 'bogus', content: 'x' });
    expect(res.isError).toBe(true);
  });

  it('forwards all required fields', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    await tool.invoke({ jobId: 'a:1', kind: 'resume', content: '# r' });
    expect(calls.writeApplicationOutput).toEqual([
      { jobId: 'a:1', kind: 'resume', content: '# r' },
    ]);
  });

  it('returns artifact handoff fields from the dependency result', async () => {
    const { deps } = makeDeps({
      writeApplicationOutput: async () =>
        ok({
          path: '/apps/acme/resume.v2.md',
          applicationDir: '/apps/acme',
          fileName: 'resume.v2.md',
          kind: 'resume',
          version: 2,
          latestPath: '/apps/acme/resume.v2.md',
        }),
    });
    const tool = getTool(createTools(deps), 'write_application_output');
    const res = await tool.invoke({ jobId: 'a:1', kind: 'resume', content: '# r' });
    expect(res.isError).toBeUndefined();
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { applicationDir: string; fileName: string; kind: string; latestPath: string };
    };
    expect(body.value).toMatchObject({
      applicationDir: '/apps/acme',
      fileName: 'resume.v2.md',
      kind: 'resume',
      latestPath: '/apps/acme/resume.v2.md',
    });
  });

  it('rejects missing content', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    const res = await tool.invoke({ jobId: 'a:1', kind: 'notes' });
    expect(res.isError).toBe(true);
  });
});

describe('list_application_versions', () => {
  it('requires jobId and kind', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'list_application_versions');
    const r1 = await tool.invoke({ kind: 'resume' });
    const r2 = await tool.invoke({ jobId: 'a:1' });
    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true);
  });

  it('forwards both', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_application_versions');
    await tool.invoke({ jobId: 'a:1', kind: 'cover-letter' });
    expect(calls.listApplicationVersions).toEqual([{ jobId: 'a:1', kind: 'cover-letter' }]);
  });
});

describe('list_recent_applications', () => {
  it('passes through with no args', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_recent_applications');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    expect(calls.listRecentApplications).toHaveLength(1);
  });
});

describe('doctor', () => {
  it('returns read-only setup readiness details', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jobhelp-doctor-tools-'));
    const prevHome = process.env['JOBHELP_HOME'];
    const prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
    process.env['JOBHELP_HOME'] = tmp;
    process.env['JOBHELP_CONFIG_PATH'] = join(tmp, '.config', 'jobhelp', 'config.json');
    mkdirSync(join(tmp, '.config', 'jobhelp'), { recursive: true });
    writeFileSync(
      process.env['JOBHELP_CONFIG_PATH'],
      JSON.stringify({
        profile: {
          resumeDumpPath: join(tmp, 'resume.md'),
          skills: ['typescript'],
          location: 'Remote',
          remoteOk: true,
          salaryFloor: 100000,
          seniority: 'mid',
          roleFamily: ['backend'],
        },
        sources: {},
        ranking: { topN: 5, digestK: 5 },
        output: { dir: join(tmp, 'digests') },
        rules: { mode: 'additive', userRulesDir: join(tmp, 'rules') },
      }),
    );
    try {
      const { deps } = makeDeps();
      const tool = getTool(createTools(deps), 'doctor');
      const res = await tool.invoke({});
      expect(res.isError).toBeUndefined();
      const body = parseResponseBody(res.content) as {
        ok: true;
        value: {
          ready: boolean;
          checks: Array<{ name: string; ok: boolean; path?: string; nextStep?: string }>;
          nextSteps: string[];
        };
      };
      expect(typeof body.value.ready).toBe('boolean');
      expect(body.value.checks.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          'config',
          'sources',
          'active_resume',
          'latest_digest',
          'rules',
          'output_dir',
          'applications_dir',
        ]),
      );
      expect(body.value.checks.find((c) => c.name === 'config')?.path).toBe(
        process.env['JOBHELP_CONFIG_PATH'],
      );
      expect(Array.isArray(body.value.nextSteps)).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
      else process.env['JOBHELP_HOME'] = prevHome;
      if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
      else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('error wrapping', () => {
  it('wraps a CoreDeps failure as isError=true', async () => {
    const { deps } = makeDeps({
      getLatestDigest: async () =>
        fail({ type: 'not_configured', message: 'config missing' }),
    });
    const tool = getTool(createTools(deps), 'get_latest_digest');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { ok: false; error: ToolError };
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe('not_configured');
  });

  it('catches thrown CoreDeps errors and converts to internal', async () => {
    const { deps } = makeDeps({
      readResume: async () => {
        throw new Error('boom');
      },
    });
    const tool = getTool(createTools(deps), 'read_resume');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { ok: false; error: ToolError };
    expect(body.error.type).toBe('internal');
    expect(body.error.message).toBe('boom');
  });

  it('rejects non-object arguments', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'init_config');
    const res = await tool.invoke('not an object');
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
  });

  it('accepts undefined args (treated as empty object)', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_recent_applications');
    const res = await tool.invoke(undefined);
    expect(res.isError).toBeUndefined();
    expect(calls.listRecentApplications).toHaveLength(1);
  });
});
