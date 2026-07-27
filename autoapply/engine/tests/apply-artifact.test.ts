import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { applyOneJob, type ApplyDeps } from '../src/apply.ts';
import { readArtifact } from '../src/review-artifact.ts';
import type { Ats } from '../src/ats/types.ts';
import type { FilledField } from '../src/ats/types.ts';
import type { ReadyJob } from '../src/types.ts';

const PAGE = {} as Page;

const PROFILE_FIELDS: readonly FilledField[] = [
  { fieldKey: 'first_name', question: 'First Name', value: 'Jane', source: 'profile', required: true },
  { fieldKey: 'email', question: 'Email', value: 'jane@example.com', source: 'profile', required: true },
];

function fakeAts(over: Partial<Ats> = {}): Ats {
  return {
    name: 'fake',
    matches: () => true,
    openForm: async () => undefined,
    fill: async () => ({
      filledKnown: 2,
      freeform: [{ fieldKey: 'q1', label: 'Why us?', kind: 'textarea' }],
      guesses: [],
      resumeUploaded: true,
      fields: [...PROFILE_FIELDS],
    }),
    applyFreeform: async () => ['q1'],
    validate: async () => ({ ok: true, blockers: [], captcha: false }),
    submit: async () => undefined,
    ...over,
  };
}

async function makeJob(): Promise<{ job: ReadyJob; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'apply-artifact-'));
  const dir = join(root, 'job');
  await mkdir(dir, { recursive: true });
  const resumeMdPath = join(dir, 'resume.v1.md');
  await writeFile(resumeMdPath, '# Jane\n');
  return {
    root,
    job: { jobId: 'j1', company: 'Acme', role: 'SWE', url: 'https://fake.test/j1', dir, resumeMdPath },
  };
}

function deps(root: string, over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    ats: fakeAts(),
    converter: { convert: async () => undefined },
    sidecarPath: join(root, 'status.json'),
    autoSubmit: false,
    dryRun: false,
    prefill: false,
    freeformWaitMs: 0,
    now: () => '2026-07-23T00:00:00.000Z',
    ...over,
  };
}

describe('applyOneJob writes the v2 review artifact', () => {
  it('records fill fields plus drafted freeform answers on the park path', async () => {
    const { job, root } = await makeJob();
    await writeFile(join(job.dir, 'freeform-answers.json'), JSON.stringify({ q1: 'Because.' }));
    const row = await applyOneJob(PAGE, job, {}, deps(root));
    expect(row.status).toBe('filled_parked');

    const artifact = await readArtifact(job.dir);
    expect(artifact?.schemaVersion).toBe(2);
    expect(artifact?.jobId).toBe('j1');
    expect(artifact?.company).toBe('Acme');
    expect(artifact?.url).toBe('https://fake.test/j1');
    expect(artifact?.filledAt).toBe('2026-07-23T00:00:00.000Z');
    expect(artifact?.verdict).toBe('review');
    expect(artifact?.green).toBe(2);
    expect(artifact?.fields).toHaveLength(3);
    expect(artifact?.fields[2]).toEqual({
      fieldKey: 'q1',
      question: 'Why us?',
      value: 'Because.',
      source: 'drafted',
      reason: 'freeform',
    });
  });

  it('writes the artifact on the prefill path too', async () => {
    const { job, root } = await makeJob();
    const row = await applyOneJob(PAGE, job, {}, deps(root, { prefill: true }));
    expect(row.status).toBe('prefilled');

    const artifact = await readArtifact(job.dir);
    expect(artifact?.schemaVersion).toBe(2);
    expect(artifact?.fields).toEqual(PROFILE_FIELDS);
    expect(artifact?.verdict).toBe('ready');
    expect(artifact?.green).toBe(2);
  });
});
