import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools } from '../../mcp/src/tools.js';
import { handleRecordJobVerdicts } from '../../mcp/src/wiring-handlers-verdicts.js';
import { persistDigest } from '../../core/state/digestStore.js';
import { readState } from '../../core/state/store.js';
import { identityKey } from '../../core/pipeline/identity.js';
import type { ToolError } from '../../mcp/src/tools.js';
import type { RankedJob } from '../../core/types/pipeline.js';
import { getTool, makeDeps, parseResponseBody } from './_fixtures.js';

describe('record_job_verdicts tool parsing', () => {
  it('requires a non-empty verdicts array', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'record_job_verdicts');
    const missing = await tool.invoke({});
    const empty = await tool.invoke({ verdicts: [] });
    expect(missing.isError).toBe(true);
    expect(empty.isError).toBe(true);
    expect(calls.recordJobVerdicts).toEqual([]);
  });

  it('rejects an unknown verdict enum value', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'record_job_verdicts');
    const res = await tool.invoke({ verdicts: [{ jobId: 'a:1', verdict: 'meh' }] });
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
    expect(body.error.message).toContain('verdict');
    expect(calls.recordJobVerdicts).toEqual([]);
  });

  it('rejects an item missing jobId', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'record_job_verdicts');
    const res = await tool.invoke({ verdicts: [{ verdict: 'drop' }] });
    expect(res.isError).toBe(true);
  });

  it('forwards valid verdicts including optional reason', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'record_job_verdicts');
    const res = await tool.invoke({
      verdicts: [
        { jobId: 'a:1', verdict: 'strong', reason: 'stack match' },
        { jobId: 'a:2', verdict: 'skipped' },
      ],
    });
    expect(res.isError).toBeUndefined();
    expect(calls.recordJobVerdicts).toEqual([
      {
        verdicts: [
          { jobId: 'a:1', verdict: 'strong', reason: 'stack match' },
          { jobId: 'a:2', verdict: 'skipped' },
        ],
      },
    ]);
  });
});

describe('handleRecordJobVerdicts against a seeded digest', () => {
  let sandbox: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-verdict-mcp-'));
    prevHome = process.env['JOBHELP_HOME'];
    process.env['JOBHELP_HOME'] = sandbox;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    rmSync(sandbox, { recursive: true, force: true });
  });

  function rankedJob(id: string, company: string, title: string): RankedJob {
    return {
      rank: 1,
      score: 0.9,
      breakdown: { keywordOverlap: 0.9, recencyBoost: 1, bm25f: 2 },
      job: {
        id,
        source: 'fixture',
        url: `https://example.test/jobs/${id}`,
        title,
        company,
        location: 'Remote',
        remote: 'remote',
        description: 'Build APIs.',
      },
    };
  }

  async function seedDigest(): Promise<void> {
    const persisted = await persistDigest({
      date: '2026-07-20',
      generatedAt: '2026-07-20T00:00:00.000Z',
      totalDurationMs: 0,
      sourceResults: [{ source: 'fixture', jobCount: 2, durationMs: 0 }],
      jobs: [
        rankedJob('fixture:1', 'Acme', 'Backend Engineer'),
        rankedJob('fixture:2', 'Globex', 'Platform Engineer'),
      ],
    });
    if (!persisted.ok) throw new Error(persisted.error.message);
  }

  it('resolves jobIds from the latest digest and persists verdict entries', async () => {
    await seedDigest();
    const result = await handleRecordJobVerdicts({
      verdicts: [
        { jobId: 'fixture:1', verdict: 'drop', reason: 'wrong domain' },
        { jobId: 'fixture:2', verdict: 'solid' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recorded).toBe(2);
    expect(result.value.unresolvedIds).toEqual([]);

    const state = await readState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const verdicts = state.value.verdicts ?? [];
    expect(verdicts).toHaveLength(2);
    const dropEntry = verdicts.find((v) => v.jobId === 'fixture:1');
    expect(dropEntry).toMatchObject({
      identityKey: identityKey('Acme', 'Backend Engineer'),
      company: 'Acme',
      title: 'Backend Engineer',
      url: 'https://example.test/jobs/fixture:1',
      verdict: 'drop',
      reason: 'wrong domain',
    });
    expect(dropEntry?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports unknown jobIds as unresolvedIds while recording the known ones', async () => {
    await seedDigest();
    const result = await handleRecordJobVerdicts({
      verdicts: [
        { jobId: 'fixture:1', verdict: 'skipped' },
        { jobId: 'fixture:nope', verdict: 'drop' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recorded).toBe(1);
    expect(result.value.unresolvedIds).toEqual(['fixture:nope']);

    const state = await readState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.value.verdicts).toHaveLength(1);
    expect(state.value.verdicts?.[0]?.verdict).toBe('skipped');
  });

  it('returns not_found when no digest has been generated', async () => {
    const result = await handleRecordJobVerdicts({
      verdicts: [{ jobId: 'fixture:1', verdict: 'drop' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('not_found');
  });

  it('succeeds with recorded 0 when every jobId is unresolved', async () => {
    await seedDigest();
    const result = await handleRecordJobVerdicts({
      verdicts: [{ jobId: 'fixture:ghost', verdict: 'drop' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recorded).toBe(0);
    expect(result.value.unresolvedIds).toEqual(['fixture:ghost']);
    const state = await readState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.value.verdicts ?? []).toEqual([]);
  });
});
