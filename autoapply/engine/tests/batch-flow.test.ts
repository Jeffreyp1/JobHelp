import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { parseCli } from '../src/cli.ts';
import { runPool } from '../src/pool.ts';
import { loadStatuses, setStatus } from '../src/status.ts';
import { applyOneJob, type ApplyDeps } from '../src/apply.ts';
import type { Ats, ValidationOutcome } from '../src/ats/types.ts';
import type { ReadyJob } from '../src/types.ts';
import { buildLeftovers, readLeftovers, writeLeftovers, type LeftoversFile } from '../src/leftovers.ts';
import {
  buildLeftoverCompletion,
  scanPrefilled,
  watchLeftovers,
  type WatchJob,
} from '../src/leftovers-watch.ts';

const PAGE = {} as Page;

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('parseCli batch defaults', () => {
  it('defaults concurrency to 3', () => {
    expect(parseCli([]).concurrency).toBe(3);
  });

  it('honors an explicit --concurrency', () => {
    expect(parseCli(['--concurrency', '1']).concurrency).toBe(1);
  });

  it('parses --watch-leftovers seconds into milliseconds, defaulting to 0', () => {
    expect(parseCli([]).watchLeftoversMs).toBe(0);
    expect(parseCli(['--watch-leftovers', '120']).watchLeftoversMs).toBe(120000);
  });
});

describe('runPool with concurrent status writes', () => {
  it('runs 3 lanes at once and loses no sidecar record', async () => {
    const dir = await tmp('batch-pool-');
    const sidecar = join(dir, 'status.json');
    const jobIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool(jobIds, 3, async (jobId) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      await setStatus(sidecar, { jobId, status: 'prefilled', updatedAt: '2026-07-16T00:00:00.000Z' });
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(3);
    const statuses = await loadStatuses(sidecar);
    expect(Object.keys(statuses).sort()).toEqual(jobIds);
    for (const jobId of jobIds) expect(statuses[jobId]?.status).toBe('prefilled');
  });
});

function fakeAts(over: Partial<Ats> = {}): Ats {
  return {
    name: 'fake',
    matches: () => true,
    openForm: async () => undefined,
    fill: async () => ({ filledKnown: 2, freeform: [], guesses: [], resumeUploaded: true, fields: [] }),
    applyFreeform: async () => [],
    validate: async () => ({ ok: true, blockers: [], captcha: false }),
    submit: async () => undefined,
    ...over,
  };
}

describe('prefill phase never waits on answers', () => {
  it('writes leftovers and returns immediately even with a long freeform timeout', async () => {
    const root = await tmp('batch-prefill-');
    const dir = join(root, 'job');
    await mkdir(dir, { recursive: true });
    const resumeMdPath = join(dir, 'resume.v1.md');
    await writeFile(resumeMdPath, '# Jane\n');
    const job: ReadyJob = { jobId: 'j1', company: 'Acme', role: 'SWE', url: 'https://fake.test/j1', dir, resumeMdPath };
    let freeformApplied = false;
    const deps: ApplyDeps = {
      ats: fakeAts({
        fill: async () => ({
          filledKnown: 3,
          freeform: [{ fieldKey: 'q1', label: 'Why us?', kind: 'textarea' }],
          guesses: [],
          resumeUploaded: true,
          fields: [],
        }),
        applyFreeform: async () => {
          freeformApplied = true;
          return [];
        },
      }),
      converter: { convert: async () => undefined },
      sidecarPath: join(root, 'status.json'),
      autoSubmit: false,
      dryRun: false,
      prefill: true,
      freeformWaitMs: 30000,
      now: () => '2026-07-16T00:00:00.000Z',
    };
    const start = Date.now();
    const row = await applyOneJob(PAGE, job, {}, deps);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(row.status).toBe('prefilled');
    expect(freeformApplied).toBe(false);
    const leftovers = JSON.parse(await readFile(join(dir, 'autoapply-leftovers.json'), 'utf8')) as LeftoversFile;
    expect(leftovers.fields.map((f) => f.fieldKey)).toEqual(['q1']);
  });
});

const VALIDATION_OK: ValidationOutcome = { ok: true, blockers: [], captcha: false };

function leftoversFixture(over: Partial<LeftoversFile> = {}): LeftoversFile {
  const base = buildLeftovers({
    url: 'https://fake.test/j1',
    company: 'Acme',
    role: 'SWE',
    outcome: {
      filledKnown: 5,
      freeform: [
        { fieldKey: 'q1', label: 'Why us?', kind: 'textarea' },
        { fieldKey: 'q2', label: 'Years of experience', kind: 'select', options: ['1', '2'] },
      ],
      guesses: [],
      resumeUploaded: true,
      fields: [],
    },
    validation: VALIDATION_OK,
    now: () => '2026-07-16T00:00:00.000Z',
  });
  return { ...base, ...over };
}

describe('readLeftovers', () => {
  it('round-trips writeLeftovers', async () => {
    const dir = await tmp('batch-leftovers-');
    const data = leftoversFixture();
    await writeLeftovers(dir, data);
    expect(await readLeftovers(dir)).toEqual(data);
  });

  it('returns null when the file is absent', async () => {
    const dir = await tmp('batch-leftovers-');
    expect(await readLeftovers(dir)).toBeNull();
  });

  it('throws on a malformed leftovers file', async () => {
    const dir = await tmp('batch-leftovers-');
    await writeFile(join(dir, 'autoapply-leftovers.json'), JSON.stringify({ url: 5 }));
    await expect(readLeftovers(dir)).rejects.toThrow(/leftovers/);
  });
});

describe('buildLeftoverCompletion', () => {
  const input = {
    jobId: 'j1',
    answers: { q1: 'because', q2: '2', q3: 'never landed' },
    applied: ['q1', 'q2'] as const,
    validation: { ok: false, blockers: ['_systemfield_resume', 'Why us?'], captcha: false },
    fileInputKeys: ['_systemfield_resume'] as const,
    now: () => '2026-07-16T01:00:00.000Z',
  };

  it('drops file-input blockers when the leftovers recorded a verified resume upload', () => {
    const done = buildLeftoverCompletion({ ...input, leftovers: leftoversFixture() });
    expect(done.blockers).toEqual(['Why us?']);
  });

  it('keeps file-input blockers when the resume was not uploaded or leftovers are missing', () => {
    const notUploaded = buildLeftoverCompletion({
      ...input,
      leftovers: leftoversFixture({ resumeUploaded: false }),
    });
    expect(notUploaded.blockers).toEqual(['_systemfield_resume', 'Why us?']);
    const noFile = buildLeftoverCompletion({ ...input, leftovers: null });
    expect(noFile.blockers).toEqual(['_systemfield_resume', 'Why us?']);
  });

  it('writes filled_parked with guessed fields typed by question kind, and reports notApplied', () => {
    const done = buildLeftoverCompletion({ ...input, leftovers: leftoversFixture() });
    expect(done.record).toEqual({
      jobId: 'j1',
      status: 'filled_parked',
      updatedAt: '2026-07-16T01:00:00.000Z',
      guessed: [
        { fieldKey: 'q1', question: 'Why us?', answer: 'because', reason: 'freeform' },
        { fieldKey: 'q2', question: 'Years of experience', answer: '2', reason: 'dropdown' },
      ],
    });
    expect(done.notApplied).toEqual(['q3']);
  });
});

describe('scanPrefilled', () => {
  it('joins prefilled sidecar records with the MCP state entries', async () => {
    const root = await tmp('batch-scan-');
    const applications = [
      { jobId: 'p1', company: 'Acme', role: 'SWE', date: '2026-07-15', dir: join(root, 'p1'), url: 'https://fake.test/p1', updatedAt: '2026-07-15T00:00:00.000Z' },
      { jobId: 'p2', company: 'Beta', role: 'SRE', date: '2026-07-15', dir: join(root, 'p2'), url: 'https://fake.test/p2', updatedAt: '2026-07-15T00:00:00.000Z' },
      { jobId: 'nourl', company: 'Gamma', role: 'PM', date: '2026-07-15', dir: join(root, 'nourl'), updatedAt: '2026-07-15T00:00:00.000Z' },
    ];
    const stateFile = join(root, 'state.json');
    await writeFile(stateFile, JSON.stringify({ applications }));
    const sidecar = join(root, 'status.json');
    for (const jobId of ['p1', 'nourl']) {
      await setStatus(sidecar, { jobId, status: 'prefilled', updatedAt: '2026-07-16T00:00:00.000Z' });
    }
    await setStatus(sidecar, { jobId: 'p2', status: 'filled_parked', updatedAt: '2026-07-16T00:00:00.000Z' });
    const jobs = await scanPrefilled(stateFile, sidecar);
    expect(jobs.map((j) => j.jobId)).toEqual(['p1']);
    expect(jobs[0]).toEqual({ jobId: 'p1', company: 'Acme', role: 'SWE', url: 'https://fake.test/p1', dir: join(root, 'p1') });
  });
});

function watchJob(jobId: string): WatchJob {
  return { jobId, company: 'Acme', role: 'SWE', url: `https://fake.test/${jobId}`, dir: `/fake/${jobId}` };
}

describe('watchLeftovers', () => {
  it('applies answers as they appear, then exits once until() is true and nothing is pending', async () => {
    const j1 = watchJob('j1');
    const j2 = watchJob('j2');
    const answers = new Map<string, Record<string, string> | null>([
      [j1.dir, { q1: 'a' }],
      [j2.dir, null],
    ]);
    setTimeout(() => answers.set(j2.dir, { q2: 'b' }), 60);
    const applied: string[] = [];
    const start = Date.now();
    const outcome = await watchLeftovers({
      scan: async () => [j1, j2],
      readAnswers: async (dir) => answers.get(dir) ?? null,
      apply: async (job) => {
        applied.push(job.jobId);
      },
      durationMs: 5000,
      pollMs: 10,
      until: () => true,
    });
    expect(applied).toEqual(['j1', 'j2']);
    expect(outcome.applied.map((j) => j.jobId)).toEqual(['j1', 'j2']);
    expect(outcome.pending).toEqual([]);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('picks up jobs that become prefilled mid-watch', async () => {
    const j1 = watchJob('j1');
    const j2 = watchJob('j2');
    const scanned: WatchJob[] = [j1];
    setTimeout(() => scanned.push(j2), 50);
    const applied: string[] = [];
    const outcome = await watchLeftovers({
      scan: async () => [...scanned],
      readAnswers: async () => ({ q: 'x' }),
      apply: async (job) => {
        applied.push(job.jobId);
      },
      durationMs: 5000,
      pollMs: 10,
      until: () => scanned.length === 2,
    });
    expect(applied).toEqual(['j1', 'j2']);
    expect(outcome.pending).toEqual([]);
  });

  it('returns still-unanswered jobs as pending when the deadline passes', async () => {
    const j1 = watchJob('j1');
    const outcome = await watchLeftovers({
      scan: async () => [j1],
      readAnswers: async () => null,
      apply: async () => undefined,
      durationMs: 80,
      pollMs: 10,
    });
    expect(outcome.applied).toEqual([]);
    expect(outcome.pending.map((j) => j.jobId)).toEqual(['j1']);
  });

  it('records a per-job apply failure and keeps watching the rest', async () => {
    const j1 = watchJob('j1');
    const j2 = watchJob('j2');
    const outcome = await watchLeftovers({
      scan: async () => [j1, j2],
      readAnswers: async () => ({ q: 'x' }),
      apply: async (job) => {
        if (job.jobId === 'j1') throw new Error('tab vanished');
      },
      durationMs: 5000,
      pollMs: 10,
      until: () => true,
    });
    expect(outcome.applied.map((j) => j.jobId)).toEqual(['j2']);
    expect(outcome.failed).toEqual([{ job: j1, error: 'tab vanished' }]);
    expect(outcome.pending).toEqual([]);
  });
});
