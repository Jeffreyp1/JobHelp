import { describe, expect, it } from 'vitest';
import type { RankedJob } from '../../core/types/pipeline.js';
import type {
  GetLatestDigestResult,
  StartApplicationArgs,
  StartApplicationResult,
  ToolError,
} from '../../mcp/src/tools.js';
import { createTools } from '../../mcp/src/tools.js';
import { fail, getTool, makeDeps, ok, parseResponseBody } from './_fixtures.js';

describe('prepare_batch_applications', () => {
  it('defaults to the top 25 digest jobs and starts each application', async () => {
    const started: StartApplicationArgs[] = [];
    const { deps } = makeDeps({
      getLatestDigest: async () => ok(latestDigest(30)),
      startApplication: async (args) => {
        started.push(args);
        return ok(startedApplication(args.jobId ?? 'missing', started.length));
      },
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const res = await tool.invoke({});

    expect(res.isError).toBeUndefined();
    expect(started).toHaveLength(25);
    expect(started[0]).toEqual({ jobId: 'job:1' });
    expect(started[24]).toEqual({ jobId: 'job:25' });
    const body = parseResponseBody(res.content) as { ok: true; value: BatchBody };
    expect(body.value.batchId).toMatch(/^batch-2026-05-26T12-00-00Z-[0-9a-f]{12}$/u);
    expect(body.value.digestGeneratedAt).toBe('2026-05-26T12:00:00Z');
    expect(body.value.digestPath).toBe('/digests/latest.json');
    expect(body.value.availableCount).toBe(30);
    expect(body.value.requestedCount).toBe(25);
    expect(body.value.readyCount).toBe(25);
    expect(body.value.failedCount).toBe(0);
    expect(body.value.skippedCount).toBe(0);
    expect(body.value.nextStep).toBe(
      'Run tailor_resume, validate_resume, and write_application_output for each ready item.',
    );
    expect(body.value.items).toHaveLength(25);
    expect(body.value.items[0]).toMatchObject({
      status: 'ready',
      jobId: 'job:1',
      rank: 1,
      score: 0.99,
      company: 'Company 1',
      role: 'Role 1',
      title: 'Role 1',
      url: 'https://example.test/jobs/1',
      location: 'Remote',
      applicationPath: '/apps/job-1',
      created: true,
      basedOnResumeName: 'backend',
      jobDescriptionPath: '/apps/job-1/jd.md',
      nextAction: 'tailor_resume',
    });
  });

  it('reports the requested count when the digest has fewer jobs', async () => {
    const started: StartApplicationArgs[] = [];
    const { deps } = makeDeps({
      getLatestDigest: async () => ok(latestDigest(3)),
      startApplication: async (args) => {
        started.push(args);
        return ok(startedApplication(args.jobId ?? 'missing', started.length));
      },
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const res = await tool.invoke({ count: 25 });

    expect(res.isError).toBeUndefined();
    expect(started).toHaveLength(3);
    const body = parseResponseBody(res.content) as { ok: true; value: BatchBody };
    expect(body.value.requestedCount).toBe(25);
    expect(body.value.readyCount).toBe(3);
    expect(body.value.items).toHaveLength(3);
  });

  it('uses different batch ids for different selections from the same digest', async () => {
    const { deps } = makeDeps({
      getLatestDigest: async () => ok(latestDigest(3)),
      startApplication: async (args) => ok(startedApplication(args.jobId ?? 'missing', 1)),
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const oneJob = await tool.invoke({ count: 1 });
    const twoJobs = await tool.invoke({ count: 2 });
    const explicitOne = await tool.invoke({ jobIds: ['job:1'] });
    const explicitTwo = await tool.invoke({ jobIds: ['job:2'] });

    const oneBody = parseResponseBody(oneJob.content) as { ok: true; value: BatchBody };
    const twoBody = parseResponseBody(twoJobs.content) as { ok: true; value: BatchBody };
    const explicitOneBody = parseResponseBody(explicitOne.content) as { ok: true; value: BatchBody };
    const explicitTwoBody = parseResponseBody(explicitTwo.content) as { ok: true; value: BatchBody };
    expect(oneBody.value.batchId).not.toBe(twoBody.value.batchId);
    expect(explicitOneBody.value.batchId).not.toBe(explicitTwoBody.value.batchId);
  });

  it('honors explicit job ids and reports digest misses as skipped', async () => {
    const started: StartApplicationArgs[] = [];
    const { deps } = makeDeps({
      getLatestDigest: async () => ok(latestDigest(3)),
      startApplication: async (args) => {
        started.push(args);
        return ok(startedApplication(args.jobId ?? 'missing', started.length));
      },
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const res = await tool.invoke({
      jobIds: ['job:3', 'missing', 'job:1'],
      basedOnResumeName: 'backend',
    });

    expect(res.isError).toBeUndefined();
    expect(started).toEqual([
      { jobId: 'job:3', basedOnResumeName: 'backend' },
      { jobId: 'job:1', basedOnResumeName: 'backend' },
    ]);
    const body = parseResponseBody(res.content) as { ok: true; value: BatchBody };
    expect(body.value.requestedCount).toBe(3);
    expect(body.value.readyCount).toBe(2);
    expect(body.value.skippedCount).toBe(1);
    expect(body.value.items.map((item) => [item.jobId, item.status])).toEqual([
      ['job:3', 'ready'],
      ['missing', 'skipped'],
      ['job:1', 'ready'],
    ]);
    expect(body.value.items[1]).toMatchObject({
      error: { type: 'not_found', message: 'job id was not found in the latest digest' },
    });
  });

  it('reports per-job start failures without failing the whole batch', async () => {
    const { deps } = makeDeps({
      getLatestDigest: async () => ok(latestDigest(3)),
      startApplication: async (args) => {
        if (args.jobId === 'job:2') {
          return fail({ type: 'io_error', message: 'disk full' });
        }
        return ok(startedApplication(args.jobId ?? 'missing', 1));
      },
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const res = await tool.invoke({ count: 3 });

    expect(res.isError).toBeUndefined();
    const body = parseResponseBody(res.content) as { ok: true; value: BatchBody };
    expect(body.value.readyCount).toBe(2);
    expect(body.value.failedCount).toBe(1);
    expect(body.value.items.map((item) => [item.jobId, item.status])).toEqual([
      ['job:1', 'ready'],
      ['job:2', 'failed'],
      ['job:3', 'ready'],
    ]);
    expect(body.value.items[1]).toMatchObject({
      error: { type: 'io_error', message: 'disk full' },
    });
  });

  it('rejects invalid counts and empty job ids before reading the digest', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'prepare_batch_applications');

    const countRes = await tool.invoke({ count: 0 });
    const idsRes = await tool.invoke({ jobIds: ['job:1', ''] });

    expect(countRes.isError).toBe(true);
    expect(idsRes.isError).toBe(true);
    expect(calls.getLatestDigest).toEqual([]);
  });

  it('rejects unknown input keys before reading the digest', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'prepare_batch_applications');

    const res = await tool.invoke({ jobId: 'job:1' });

    expect(res.isError).toBe(true);
    expect(calls.getLatestDigest).toEqual([]);
  });

  it('passes through latest digest errors', async () => {
    const error: ToolError = { type: 'not_found', message: 'no digest yet' };
    const { deps } = makeDeps({
      getLatestDigest: async () => fail(error),
    });

    const tool = getTool(createTools(deps), 'prepare_batch_applications');
    const res = await tool.invoke({});

    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { ok: false; error: ToolError };
    expect(body.error).toEqual(error);
  });
});

interface BatchBody {
  readonly batchId: string;
  readonly digestGeneratedAt: string;
  readonly digestPath: string;
  readonly availableCount: number;
  readonly requestedCount: number;
  readonly readyCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly items: readonly BatchItem[];
  readonly nextStep: string;
}

interface BatchItem {
  readonly status: 'ready' | 'failed' | 'skipped';
  readonly jobId: string;
  readonly rank?: number;
  readonly score?: number;
  readonly company?: string;
  readonly role?: string;
  readonly title?: string;
  readonly url?: string;
  readonly location?: string;
  readonly applicationPath?: string;
  readonly created?: boolean;
  readonly basedOnResumeName?: string;
  readonly jobDescriptionPath?: string;
  readonly nextAction?: string;
  readonly error?: ToolError;
}

function latestDigest(count: number): GetLatestDigestResult {
  return {
    path: '/digests/latest.json',
    generatedAt: '2026-05-26T12:00:00Z',
    jobs: Array.from({ length: count }, (_, index) => rankedJob(index + 1)),
  };
}

function rankedJob(n: number): RankedJob {
  return {
    job: {
      id: `job:${n}`,
      source: 'test',
      url: `https://example.test/jobs/${n}`,
      title: `Role ${n}`,
      company: `Company ${n}`,
      location: 'Remote',
      remote: 'remote',
      description: `Job ${n} description`,
    },
    rank: n,
    score: 1 - n / 100,
    breakdown: { keywordOverlap: 1, recencyBoost: 1, bm25f: 1 },
  };
}

function startedApplication(jobId: string, n: number): StartApplicationResult {
  return {
    jobId,
    path: `/apps/${jobId.replace(':', '-')}`,
    created: n % 2 === 1,
    basedOnResumeName: 'backend',
    jobDescriptionPath: `/apps/${jobId.replace(':', '-')}/jd.md`,
  };
}
