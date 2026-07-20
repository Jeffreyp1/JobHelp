import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectReadyJobs } from '../src/queue.ts';
import { loadStatuses, setStatus } from '../src/status.ts';

const JOB_IDS = [
  'fresh',
  'failed',
  'submitted',
  'submitted_unverified',
  'prefilled',
  'filled_parked',
  'blocked',
  'junk',
] as const;

interface Fixture {
  stateFile: string;
  sidecar: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'queue-status-'));
  const applications = [];
  for (const [i, jobId] of JOB_IDS.entries()) {
    const dir = join(root, jobId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'resume.v1.md'), '# resume');
    applications.push({
      jobId,
      company: 'Acme',
      role: 'Engineer',
      date: '2026-07-01',
      dir,
      url: `https://boards.greenhouse.io/acme/jobs/${i}`,
      updatedAt: `2026-07-0${i + 1}T00:00:00.000Z`,
    });
  }
  const stateFile = join(root, 'state.json');
  await writeFile(stateFile, JSON.stringify({ applications }));
  const sidecar = join(root, 'autoapply-status.json');
  const rec = (jobId: string, status: string) => ({
    jobId,
    status,
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
  const sidecarBody: Record<string, unknown> = {
    failed: rec('failed', 'failed'),
    submitted: rec('submitted', 'submitted'),
    submitted_unverified: rec('submitted_unverified', 'submitted_unverified'),
    prefilled: rec('prefilled', 'prefilled'),
    filled_parked: rec('filled_parked', 'filled_parked'),
    blocked: rec('blocked', 'blocked'),
    junk: rec('junk', 'totally_bogus'),
  };
  await writeFile(sidecar, JSON.stringify(sidecarBody, null, 2));
  return { stateFile, sidecar };
}

let fixture: Fixture;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture = await makeFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectReadyJobs status gating', () => {
  it('selects only genuinely-ready jobs, skipping parked, blocked, sent, and unknown statuses', async () => {
    const jobs = await selectReadyJobs({
      stateFile: fixture.stateFile,
      sidecar: fixture.sidecar,
      limit: 50,
    });
    expect(jobs.map((j) => j.jobId).sort()).toEqual(['failed', 'fresh']);
  });
});

describe('loadStatuses validation', () => {
  it('quarantines unknown status strings instead of passing them through', async () => {
    const map = await loadStatuses(fixture.sidecar);
    expect(map['junk']).toEqual({
      jobId: 'junk',
      status: 'quarantined',
      rawStatus: 'totally_bogus',
      updatedAt: '2026-07-10T00:00:00.000Z',
    });
  });

  it('warns via the log helper when quarantining', async () => {
    await loadStatuses(fixture.sidecar);
    const spy = vi.mocked(console.error);
    const warned = spy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('totally_bogus'),
    );
    expect(warned).toBe(true);
  });

  it('passes known statuses through unchanged, including filled_parked and blocked', async () => {
    const map = await loadStatuses(fixture.sidecar);
    expect(map['filled_parked']?.status).toBe('filled_parked');
    expect(map['blocked']?.status).toBe('blocked');
    expect(map['submitted']?.status).toBe('submitted');
  });

  it('keeps a quarantined record fail-safe across a setStatus round-trip', async () => {
    await setStatus(fixture.sidecar, {
      jobId: 'fresh',
      status: 'queued',
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
    const map = await loadStatuses(fixture.sidecar);
    expect(map['junk']).toMatchObject({
      status: 'quarantined',
      rawStatus: 'totally_bogus',
    });
    const jobs = await selectReadyJobs({
      stateFile: fixture.stateFile,
      sidecar: fixture.sidecar,
      limit: 50,
    });
    expect(jobs.map((j) => j.jobId)).not.toContain('junk');
  });
});
