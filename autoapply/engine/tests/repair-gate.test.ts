import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Page } from 'playwright';
import { applyOneJob, decideGate, type ApplyDeps } from '../src/apply.ts';
import { listRepairArtifacts } from '../src/repair-artifact.ts';
import { repairRoot } from '../src/paths.ts';
import { loadSelectorOverrides, resetSelectorOverridesForTest } from '../src/selector-overrides.ts';
import type { Ats } from '../src/ats/types.ts';
import type { ReadyJob, StandingProfile } from '../src/types.ts';

const OK_VALIDATION = { ok: true, blockers: [], captcha: false };

describe('decideGate with repaired selectors', () => {
  it('pauses even a fully deterministic form when repaired', () => {
    expect(decideGate({ autoSubmit: true, uploaded: true, validation: OK_VALIDATION, repaired: true, submitDrifted: false })).toBe('pause');
    expect(decideGate({ autoSubmit: true, uploaded: true, validation: OK_VALIDATION, repaired: false, submitDrifted: false })).toBe('submit');
  });
});

describe('decideGate with a drifted submit selector', () => {
  it('pauses auto-submit when the configured submit button no longer matches', () => {
    expect(
      decideGate({ autoSubmit: true, uploaded: true, validation: OK_VALIDATION, repaired: false, submitDrifted: true }),
    ).toBe('pause');
    expect(
      decideGate({ autoSubmit: true, uploaded: true, validation: OK_VALIDATION, repaired: false, submitDrifted: false }),
    ).toBe('submit');
  });
});

describe('applyOneJob repair behavior', () => {
  let home = '';
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'jobhelp-home-'));
    prevHome = process.env['JOBHELP_HOME'];
    process.env['JOBHELP_HOME'] = home;
    resetSelectorOverridesForTest();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    resetSelectorOverridesForTest();
  });

  function jobIn(dir: string): ReadyJob {
    return { jobId: 'j1', company: 'Acme', role: 'SWE', url: 'https://fake/1', dir, resumeMdPath: join(dir, 'resume.v1.md') };
  }

  function makeDeps(ats: Ats): ApplyDeps {
    return {
      ats,
      converter: { convert: async () => undefined },
      sidecarPath: join(home, 'autoapply-status.json'),
      autoSubmit: true,
      dryRun: false,
      prefill: false,
      freeformWaitMs: 0,
      now: () => '2026-07-20T05:00:00.000Z',
    };
  }

  it('writes a repair artifact when no fields are detected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-job-'));
    const ats: Ats = {
      name: 'fake',
      matches: () => true,
      openForm: async () => undefined,
      fill: async () => ({ filledKnown: 0, freeform: [], guesses: [], resumeUploaded: false }),
      applyFreeform: async () => [],
      validate: async () => OK_VALIDATION,
      submit: async () => undefined,
      captureRepair: async () => ({ aria: 'ARIA', formHtml: '<form/>' }),
    };
    const row = await applyOneJob({} as Page, jobIn(dir), {} as StandingProfile, makeDeps(ats));
    expect(row.status).toBe('failed');
    expect(await listRepairArtifacts(repairRoot())).toHaveLength(1);
  });

  it('force-parks and does not submit when the submit selector has drifted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-job-'));
    let submitted = false;
    const ats: Ats = {
      name: 'fake',
      matches: () => true,
      openForm: async () => undefined,
      fill: async () => ({ filledKnown: 3, freeform: [], guesses: [], resumeUploaded: true }),
      applyFreeform: async () => [],
      validate: async () => OK_VALIDATION,
      submitConfigured: async () => false,
      submit: async () => {
        submitted = true;
      },
    };
    const row = await applyOneJob({} as Page, jobIn(dir), {} as StandingProfile, makeDeps(ats));
    expect(submitted).toBe(false);
    expect(row.status).toBe('filled_parked');
    expect(row.report.notes).toContain('submit selector drifted - review before submitting');
  });

  it('still auto-submits when the submit selector is intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-job-'));
    let submitted = false;
    const ats: Ats = {
      name: 'fake',
      matches: () => true,
      openForm: async () => undefined,
      fill: async () => ({ filledKnown: 3, freeform: [], guesses: [], resumeUploaded: true }),
      applyFreeform: async () => [],
      validate: async () => OK_VALIDATION,
      submitConfigured: async () => true,
      submit: async () => {
        submitted = true;
      },
    };
    const row = await applyOneJob({} as Page, jobIn(dir), {} as StandingProfile, makeDeps(ats));
    expect(submitted).toBe(true);
    expect(row.status).toBe('submitted');
  });

  it('force-parks and annotates when the ats has an active selector override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-job-'));
    const overridesPath = join(home, 'autoapply-selector-overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, overrides: { fake: { submitSelector: '.send' } } }));
    await loadSelectorOverrides(overridesPath);
    let submitted = false;
    const ats: Ats = {
      name: 'fake',
      matches: () => true,
      openForm: async () => undefined,
      fill: async () => ({ filledKnown: 3, freeform: [], guesses: [], resumeUploaded: true }),
      applyFreeform: async () => [],
      validate: async () => OK_VALIDATION,
      submit: async () => {
        submitted = true;
      },
    };
    const row = await applyOneJob({} as Page, jobIn(dir), {} as StandingProfile, makeDeps(ats));
    expect(submitted).toBe(false);
    expect(row.status).toBe('filled_parked');
    expect(row.report.notes).toContain('repaired selectors active - review before submitting');
  });
});
