import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { makeAts } from '../src/ats/make-ats.ts';
import type { DetectedField } from '../src/ats/form-config.ts';
import type { Ats } from '../src/ats/types.ts';
import { applyOneJob, type ApplyDeps } from '../src/apply.ts';
import { buildReport, formatRunSummary } from '../src/review.ts';
import { loadStatuses } from '../src/status.ts';
import { metaPathForPdf, pdfPathForJob } from '../src/convert-pdf.ts';
import type { ReadyJob } from '../src/types.ts';
import { fakePage, nativeSelect, testCfg } from './fixtures/fake-form.ts';

const GENDER_FIELD: DetectedField = {
  id: 'gender',
  label: 'Gender',
  tag: 'select',
  type: 'select',
  required: false,
  reactSelect: false,
};

describe('makeAts fill — EEO fields never take a fuzzy non-decline pick', () => {
  it('substitutes the decline option for a fuzzy match and flags it for review', async () => {
    const sel = nativeSelect(['Male (cisgender)', 'Female', 'Prefer not to say']);
    const page = fakePage({ controls: { gender: sel.loc } });
    const ats = makeAts(testCfg([GENDER_FIELD]));
    const outcome = await ats.fill(page, { gender: 'Male' }, '/tmp/resume.pdf');
    expect(sel.selected()).toBe('Prefer not to say');
    expect(outcome.guesses).toEqual([
      { fieldKey: 'gender', question: 'Gender', answer: 'Prefer not to say', reason: 'dropdown' },
    ]);
    expect(outcome.freeform).toEqual([]);
  });

  it('takes an exact option without flagging', async () => {
    const sel = nativeSelect(['Male', 'Female', 'Decline To Self Identify']);
    const page = fakePage({ controls: { gender: sel.loc } });
    const ats = makeAts(testCfg([GENDER_FIELD]));
    const outcome = await ats.fill(page, { gender: 'Male' }, '/tmp/resume.pdf');
    expect(sel.selected()).toBe('Male');
    expect(outcome.guesses).toEqual([]);
  });

  it('leaves the field for review when no exact or decline option exists', async () => {
    const sel = nativeSelect(['Male (cisgender)', 'Female']);
    const page = fakePage({ controls: { gender: sel.loc } });
    const ats = makeAts(testCfg([GENDER_FIELD]));
    const outcome = await ats.fill(page, { gender: 'Male' }, '/tmp/resume.pdf');
    expect(sel.selected()).toBe('');
    expect(outcome.guesses).toEqual([]);
    expect(outcome.freeform.map((q) => q.fieldKey)).toEqual(['gender']);
  });

  it('declines a veteran-status radio group instead of taking the fuzzy polarity match', async () => {
    const labels: Record<string, string> = {
      'vet-1': 'I am a protected veteran',
      'vet-2': 'I identify as one or more of the classifications of protected veteran',
      'vet-3': "I don't wish to answer",
    };
    const radios = Object.keys(labels).map((id) => ({
      type: 'radio',
      name: 'veteran',
      id,
      value: id,
      required: false,
      checked: false,
      getAttribute: () => null,
      closest: (sel: string) =>
        sel === 'fieldset'
          ? { querySelector: (s: string) => (s === 'legend' ? { textContent: 'Veteran Status' } : null) }
          : null,
      ownerDocument: {
        querySelector: (s: string) => (s === `label[for="${id}"]` ? { textContent: labels[id] } : null),
      },
    }));
    let checkedId = '';
    const radioLoc = (id: string): unknown => {
      const l: Record<string, unknown> = {};
      l['first'] = () => l;
      l['check'] = () => {
        checkedId = id;
        return Promise.resolve();
      };
      l['click'] = () => Promise.resolve();
      l['isChecked'] = () => Promise.resolve(checkedId === id);
      return l;
    };
    const page = fakePage({
      controls: { 'vet-1': radioLoc('vet-1'), 'vet-2': radioLoc('vet-2'), 'vet-3': radioLoc('vet-3') },
      root: { querySelectorAll: (sel: string) => (sel.includes('radio') ? radios : []) },
    });
    const ats = makeAts(testCfg([]));
    const outcome = await ats.fill(page, { veteranStatus: 'I am not a protected veteran' }, '/tmp/resume.pdf');
    expect(checkedId).toBe('vet-3');
    expect(outcome.guesses).toEqual([
      { fieldKey: 'veteran', question: 'Veteran Status', answer: "I don't wish to answer", reason: 'dropdown' },
    ]);
  });
});

const RESUME_MD = '# Jane Doe\n\n- did a thing\n- did another thing\n';

async function makeJobFixture(): Promise<{ job: ReadyJob; sidecar: string }> {
  const root = await mkdtemp(join(tmpdir(), 'upload-gate-'));
  const dir = join(root, 'job');
  await mkdir(dir, { recursive: true });
  const resumeMdPath = join(dir, 'resume.v1.md');
  await writeFile(resumeMdPath, RESUME_MD);
  return {
    sidecar: join(root, 'status.json'),
    job: { jobId: 'j1', company: 'Acme', role: 'SWE', url: 'https://fake.test/job', dir, resumeMdPath },
  };
}

function fakeAts(over: Partial<Ats> = {}): Ats {
  return {
    name: 'fake',
    matches: () => true,
    openForm: async () => undefined,
    fill: async () => ({ filledKnown: 2, freeform: [], guesses: [], resumeUploaded: true }),
    applyFreeform: async () => [],
    validate: async () => ({ ok: true, blockers: [], captcha: false }),
    submit: async () => undefined,
    ...over,
  };
}

function makeDeps(sidecar: string, over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    ats: fakeAts(),
    converter: { convert: async () => undefined },
    sidecarPath: sidecar,
    autoSubmit: false,
    dryRun: false,
    prefill: false,
    freeformWaitMs: 0,
    now: () => '2026-07-15T00:00:00.000Z',
    ...over,
  };
}

async function writeMeta(dir: string, over: Record<string, unknown> = {}): Promise<void> {
  const meta = {
    srcSha256: createHash('sha256').update(RESUME_MD).digest('hex'),
    droppedBullets: 3,
    pageCount: 1,
    renderer: 'jaketex',
    renderedAt: '2026-07-15T00:00:00.000Z',
    ...over,
  };
  await writeFile(metaPathForPdf(pdfPathForJob(dir)), JSON.stringify(meta, null, 2));
}

const PAGE = {} as Page;

describe('applyOneJob — park status transitions', () => {
  it('records filled_parked when the pause gate completes and the tab is parked', async () => {
    const { job, sidecar } = await makeJobFixture();
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar));
    expect(row.status).toBe('filled_parked');
    const statuses = await loadStatuses(sidecar);
    expect(statuses['j1']?.status).toBe('filled_parked');
  });

  it('keeps dry-run jobs re-queueable as filled', async () => {
    const { job, sidecar } = await makeJobFixture();
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar, { dryRun: true }));
    expect(row.status).toBe('filled');
    const statuses = await loadStatuses(sidecar);
    expect(statuses['j1']?.status).toBe('filled');
  });

  it('still records needs_freeform when questions went unanswered', async () => {
    const { job, sidecar } = await makeJobFixture();
    const ats = fakeAts({
      fill: async () => ({
        filledKnown: 1,
        freeform: [{ fieldKey: 'q1', label: 'Why us?', kind: 'text' }],
        guesses: [],
        resumeUploaded: true,
      }),
    });
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar, { ats }));
    expect(row.status).toBe('needs_freeform');
  });

  it('keeps prefilled at the prefill transition', async () => {
    const { job, sidecar } = await makeJobFixture();
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar, { prefill: true }));
    expect(row.status).toBe('prefilled');
  });
});

describe('applyOneJob — conversion meta threaded into the review surface', () => {
  it('surfaces a trim note in the review report when bullets were dropped', async () => {
    const { job, sidecar } = await makeJobFixture();
    await writeMeta(job.dir);
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar));
    expect(row.report.notes).toContain('PDF trimmed: 3 bullets dropped');
  });

  it('surfaces a page-count note when the PDF still exceeds one page', async () => {
    const { job, sidecar } = await makeJobFixture();
    await writeMeta(job.dir, { droppedBullets: 0, pageCount: 2 });
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar));
    expect((row.report.notes ?? []).some((n) => /2 pages/.test(n))).toBe(true);
  });

  it('ignores a stale sidecar whose source hash does not match the resume', async () => {
    const { job, sidecar } = await makeJobFixture();
    await writeMeta(job.dir, { srcSha256: 'deadbeef' });
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar));
    expect(row.report.notes).toBeUndefined();
  });

  it('adds no notes when nothing was trimmed and the PDF is one page', async () => {
    const { job, sidecar } = await makeJobFixture();
    await writeMeta(job.dir, { droppedBullets: 0, pageCount: 1 });
    const row = await applyOneJob(PAGE, job, {}, makeDeps(sidecar));
    expect(row.report.notes).toBeUndefined();
  });

  it('carries the notes into the prefill leftovers file', async () => {
    const { job, sidecar } = await makeJobFixture();
    await writeMeta(job.dir);
    await applyOneJob(PAGE, job, {}, makeDeps(sidecar, { prefill: true }));
    const leftovers = JSON.parse(await readFile(join(job.dir, 'autoapply-leftovers.json'), 'utf8')) as {
      notes?: string[];
    };
    expect(leftovers.notes).toContain('PDF trimmed: 3 bullets dropped');
  });
});

describe('formatRunSummary — notes are human-visible', () => {
  it('prints note lines under the job entry', () => {
    const report = buildReport({
      green: 4,
      guessed: [],
      blockers: [],
      captcha: false,
      notes: ['PDF trimmed: 3 bullets dropped'],
    });
    const out = formatRunSummary([{ company: 'Acme', role: 'SWE', status: 'filled_parked', report }]);
    expect(out).toContain('PDF trimmed: 3 bullets dropped');
  });
});
