import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import { handleFindMatchingJobs, handleGetLatestDigest } from '../../mcp/src/wiring-handlers.js';
import { ALL_ADAPTERS } from '../../core/sources/index.js';
import { getLatestDigest, persistDigest } from '../../core/state/digestStore.js';
import { writeState } from '../../core/state/store.js';
import { EMPTY_STATE, type ApplicationEntry } from '../../core/state/index.js';
import type { JobDigestConfig, SourceAdapter } from '../../core/types/index.js';
import { findTool, makeJobConfig, parseToolBody, writeMinimalConfig } from './_wiring-fixtures.js';

describe('mcp/wiring application flows — boot real server with temp JOBHELP_HOME', () => {
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
      expect(result.value.nextRequiredStep).toMatch(/raw deterministic/i);
      expect(result.value.nextRequiredStep).toMatch(/rerank/i);
      const latest = await getLatestDigest();
      expect(latest.ok).toBe(true);
      if (latest.ok) expect(latest.value.jobs).toHaveLength(2);
      const latestResult = await handleGetLatestDigest();
      expect(latestResult.ok).toBe(true);
      if (latestResult.ok) expect(latestResult.value.nextRequiredStep).toMatch(/rerank/i);
    } finally {
      mutableAdapters.length = 0;
      mutableAdapters.push(...originalAdapters);
    }
  });

  function installTwoJobAdapter(): () => void {
    const original = [...ALL_ADAPTERS];
    const mutable = ALL_ADAPTERS as unknown as SourceAdapter[];
    mutable.length = 0;
    mutable.push({
      name: 'fixture',
      enabled: () => true,
      fetch: async () => [
        {
          id: 'fixture:applied',
          source: 'fixture',
          url: 'https://example.test/applied',
          title: 'Backend TypeScript Engineer',
          company: 'Acme',
          location: 'Remote',
          remote: 'remote',
          description:
            'TypeScript Go backend services for high-volume APIs, distributed systems, observability, database migrations, deployment automation, incident response, and developer experience. The role partners with product teams and ships reliable backend platform features.',
        },
        {
          id: 'fixture:fresh',
          source: 'fixture',
          url: 'https://example.test/fresh',
          title: 'Backend Go Engineer',
          company: 'Beta',
          location: 'Remote',
          remote: 'remote',
          description:
            'Go TypeScript backend services for high-volume APIs, distributed systems, observability, database migrations, deployment automation, incident response, and developer experience. The role partners with product teams and ships reliable backend platform features.',
        },
      ],
    });
    return () => {
      mutable.length = 0;
      mutable.push(...original);
    };
  }

  async function seedAppliedApplication(): Promise<void> {
    const app: ApplicationEntry = {
      jobId: 'greenhouse:some-other-id',
      company: 'acme',
      role: 'TypeScript Backend Engineer',
      date: '2026-05-10',
      dir: join(tmp, 'apps', 'acme'),
      url: 'https://other.test/xyz',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    };
    const w = await writeState({ ...EMPTY_STATE, applications: [app] });
    if (!w.ok) throw new Error(`seed state failed: ${w.error.message}`);
  }

  function withHistory(config: JobDigestConfig, enabled: boolean): JobDigestConfig {
    return { ...config, ranking: { ...config.ranking, history: { enabled } } };
  }

  it('marks already-applied jobs in the digest markdown when history is enabled', async () => {
    const restore = installTwoJobAdapter();
    try {
      await seedAppliedApplication();
      const result = await handleFindMatchingJobs(withHistory(makeJobConfig(tmp), true), {
        count: 5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const md = readFileSync(result.value.markdownPath, 'utf8');
      expect(md).toContain('- **Status:** already applied');
      expect(md.split('- **Status:** already applied')).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('does NOT read applications when history is disabled (no applied marker)', async () => {
    const restore = installTwoJobAdapter();
    try {
      await seedAppliedApplication();
      const result = await handleFindMatchingJobs(withHistory(makeJobConfig(tmp), false), {
        count: 5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const md = readFileSync(result.value.markdownPath, 'utf8');
      expect(md).not.toContain('already applied');
    } finally {
      restore();
    }
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

  it('prepare_batch_applications starts top digest jobs through the real server', async () => {
    const persisted = await persistDigest({
      date: '2026-05-15',
      generatedAt: '2026-05-15T00:00:00.000Z',
      totalDurationMs: 0,
      sourceResults: [{ source: 'fixture', jobCount: 2, durationMs: 0 }],
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
        {
          rank: 2,
          score: 0.8,
          breakdown: { keywordOverlap: 0.8, recencyBoost: 1, bm25f: 1 },
          job: {
            id: 'fixture:2',
            source: 'fixture',
            url: 'https://example.test/jobs/2',
            title: 'Platform Engineer',
            company: 'Beta',
            location: 'Remote',
            remote: 'remote',
            description: 'Build platforms.',
          },
        },
      ],
    });
    if (!persisted.ok) throw new Error(persisted.error.message);

    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    const prepare = findTool(handle.tools, 'prepare_batch_applications');
    const response = await prepare.invoke({ count: 2, basedOnResumeName: 'backend' });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value).toMatchObject({
      requestedCount: 2,
      readyCount: 2,
      failedCount: 0,
      skippedCount: 0,
    });
    const items = body.value?.['items'] as Array<Record<string, unknown>> | undefined;
    expect(items?.map((item) => item['jobId'])).toEqual(['fixture:1', 'fixture:2']);
    expect(items?.[0]?.['applicationPath']).toEqual(expect.stringContaining('acme-backend-engineer'));
    expect(items?.[0]?.['nextAction']).toBe('tailor_resume');
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
