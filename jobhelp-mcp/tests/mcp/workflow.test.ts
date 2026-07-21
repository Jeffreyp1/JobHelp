import { describe, expect, it } from 'vitest';
import { createTools } from '../../mcp/src/tools.js';
import { getTool, makeDeps, ok, parseResponseBody } from './_fixtures.js';

describe('digest to application output workflow', () => {
  it('can read a digest job, start its application, and write the first resume artifact', async () => {
    const job = {
      id: 'greenhouse:acme:42',
      source: 'greenhouse',
      url: 'https://example.test/acme/jobs/42',
      title: 'Software Engineer I',
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote' as const,
      description: 'Build TypeScript services and test automation.',
    };
    const rankedJob = {
      job,
      rank: 1,
      score: 0.92,
      breakdown: {
        keywordOverlap: 0.9,
        recencyBoost: 0.8,
        bm25f: 1.2,
        sourceTrust: 0.85,
      },
    };
    const { deps, calls } = makeDeps({
      getLatestDigest: async () =>
        ok({
          path: '/home/u/jobhelp/digests/digest-2026-05-15.md',
          generatedAt: '2026-05-15T00:00:00Z',
          jobs: [rankedJob],
          totalPersisted: 1,
          nextRequiredStep: 'rerank',
        }),
      getJob: async (id) => ok({ job: { ...job, id } }),
      startApplication: async (args) => {
        calls.startApplication.push(args);
        return ok({
          path: '/home/u/jobhelp/applications/acme-software-engineer-i-2026-05-15/',
          created: true,
          basedOnResumeName: args.basedOnResumeName ?? 'backend',
        });
      },
      writeApplicationOutput: async (args) => {
        calls.writeApplicationOutput.push(args);
        return ok({
          path: '/home/u/jobhelp/applications/acme-software-engineer-i-2026-05-15/resume.v1.md',
          version: 1,
        });
      },
    });
    const tools = createTools(deps);

    const digestRes = await getTool(tools, 'get_latest_digest').invoke({});
    const digestBody = parseResponseBody(digestRes.content) as {
      ok: true;
      value: { jobs: Array<typeof rankedJob> };
    };
    const selected = digestBody.value.jobs[0];

    const jobRes = await getTool(tools, 'get_job').invoke({ id: selected?.job.id });
    const jobBody = parseResponseBody(jobRes.content) as { ok: true; value: { job: { id: string } } };
    expect(jobBody.value.job.id).toBe('greenhouse:acme:42');

    const startRes = await getTool(tools, 'start_application').invoke({
      jobId: jobBody.value.job.id,
      basedOnResumeName: 'backend',
    });
    const startBody = parseResponseBody(startRes.content) as { ok: true; value: { path: string } };
    expect(startBody.value.path).toContain('/applications/acme-software-engineer-i-2026-05-15/');

    const writeRes = await getTool(tools, 'write_application_output').invoke({
      jobId: jobBody.value.job.id,
      kind: 'resume',
      content: '# Tailored resume\n',
    });
    const writeBody = parseResponseBody(writeRes.content) as {
      ok: true;
      value: { path: string; version?: number };
    };
    expect(writeBody.value).toEqual({
      path: '/home/u/jobhelp/applications/acme-software-engineer-i-2026-05-15/resume.v1.md',
      version: 1,
    });
    expect(calls.startApplication).toEqual([
      { jobId: 'greenhouse:acme:42', basedOnResumeName: 'backend' },
    ]);
    expect(calls.writeApplicationOutput).toEqual([
      { jobId: 'greenhouse:acme:42', kind: 'resume', content: '# Tailored resume\n' },
    ]);
  });
});
