/** @vitest-environment jsdom */
/**
 * Tests for the Jobs tab (the Phase-1 daily-digest UI).
 *
 * Renders `renderJobsTab` directly with vi.fn()-mocked hooks; jsdom env.
 * Covers: controller surface, empty state, applyDigestResult rendering,
 * row expand, action-bar wiring (Open posting / Mark applied / Dismiss /
 * Tailor resume), Refresh-digest + Re-extract-profile, graceful no-ops when
 * hooks are absent, setBusy, and the footer summary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderJobsTab } from '../../src/sidepanel/tabs/jobs';
import type { JobsTabHooks } from '../../src/sidepanel/tabs/jobs';
import type { DiscoverAndRankResult } from '../../src/types/api-contract';
import type { RankedJob, JobProfile } from '../../src/types/job-discovery';

function makeJob(over: Partial<RankedJob> = {}): RankedJob {
  return {
    id: 'job-1',
    source: 'greenhouse',
    company: 'Acme Corp',
    title: 'Senior Engineer',
    location: 'Remote',
    remote: true,
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    descriptionText: 'We are looking for a senior engineer. '.repeat(40),
    postedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    discoveredAt: Date.now(),
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: 'USD',
    keywordScore: 0.7,
    fitScore: 0.8,
    recencyBoost: 0.95,
    finalScore: 0.73,
    matchedSkills: ['Python', 'AWS'],
    missingSkills: ['Rust', 'GraphQL'],
    ...over,
  };
}

function makeResult(jobs: RankedJob[], over: Partial<DiscoverAndRankResult> = {}): DiscoverAndRankResult {
  return {
    discoveredCount: 42,
    rankedCount: jobs.length,
    jobs,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet/edit',
    cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.0123 },
    ...over,
  };
}

describe('Jobs tab — renderJobsTab', () => {
  let hooks: {
    onRunDigest: ReturnType<typeof vi.fn>;
    onExtractProfile: ReturnType<typeof vi.fn>;
    onTailorJob: ReturnType<typeof vi.fn>;
    onMarkStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    hooks = {
      onRunDigest: vi.fn(),
      onExtractProfile: vi.fn(),
      onTailorJob: vi.fn(),
      onMarkStatus: vi.fn(),
    };
  });

  it('returns a controller with the expected methods', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    expect(ctrl.root.classList.contains('tab-pane--jobs')).toBe(true);
    expect(typeof ctrl.applyDigestResult).toBe('function');
    expect(typeof ctrl.setBusy).toBe('function');
    expect(typeof ctrl.getProfile).toBe('function');
    expect(typeof ctrl.setProfile).toBe('function');
    expect(ctrl.getProfile()).toBeNull();
  });

  it('renders the header controls (refresh button, days/topN selects, fit checkbox)', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    expect(ctrl.root.querySelector('.jobs__refresh')?.textContent).toBe('Refresh digest');
    expect(ctrl.root.querySelector('.jobs__days-select')).not.toBeNull();
    expect(ctrl.root.querySelector('.jobs__topn-select')).not.toBeNull();
    expect(ctrl.root.querySelector('.jobs__fit-checkbox')).not.toBeNull();
    expect(ctrl.root.querySelector('.jobs__reextract')).not.toBeNull();
  });

  it('renders the empty state initially', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    const empty = ctrl.root.querySelector('.jobs__empty') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('Refresh digest');
    expect(ctrl.root.querySelectorAll('.jobs-row').length).toBe(0);
  });

  it('applyDigestResult renders one row per RankedJob with score badge + source', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([
      makeJob({ id: 'a', company: 'Acme', finalScore: 0.73, source: 'greenhouse' }),
      makeJob({ id: 'b', company: 'Globex', finalScore: 0.61, source: 'lever' }),
    ]));
    const rows = ctrl.root.querySelectorAll('.jobs-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.jobs-row__score')?.textContent).toBe('73%');
    expect(rows[0].querySelector('.jobs-row__source')?.textContent).toBe('greenhouse');
    expect(rows[1].querySelector('.jobs-row__score')?.textContent).toBe('61%');
    expect(rows[1].querySelector('.jobs-row__source')?.textContent).toBe('lever');
    // empty state hidden once rows present
    expect((ctrl.root.querySelector('.jobs__empty') as HTMLElement).hidden).toBe(true);
  });

  it('shows "posting date unknown" when postedAt is null', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([makeJob({ postedAt: null })]));
    expect(ctrl.root.querySelector('.jobs-row__age')?.textContent).toBe('posting date unknown');
  });

  it('clicking a row expands it (skill chips + JD snippet + action bar visible)', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([makeJob()]));
    const row = ctrl.root.querySelector('.jobs-row') as HTMLElement;
    const detail = row.querySelector('.jobs-row__detail') as HTMLElement;
    expect(detail.hidden).toBe(true);
    (row.querySelector('.jobs-row__summary') as HTMLElement).click();
    expect(detail.hidden).toBe(false);
    expect(row.classList.contains('jobs-row--expanded')).toBe(true);
    expect(row.querySelectorAll('.jobs-row__skills--matched .jobs-chip').length).toBe(2);
    expect(row.querySelectorAll('.jobs-row__skills--missing .jobs-chip--muted').length).toBe(2);
    expect(row.querySelector('.jobs-row__snippet')?.textContent).toContain('senior engineer');
    expect(row.querySelector('.jobs-row__actions')).not.toBeNull();
    // collapse again
    (row.querySelector('.jobs-row__summary') as HTMLElement).click();
    expect(detail.hidden).toBe(true);
  });

  it('"Open posting" link points at the job url and opens in a new tab', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([makeJob({ url: 'https://example.com/the-job' })]));
    const link = ctrl.root.querySelector('.jobs-row__open') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/the-job');
    expect(link.target).toBe('_blank');
  });

  it('clicking "Mark applied" calls onMarkStatus(id, "applied") and disables the button', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([makeJob({ id: 'job-x' })]));
    const btn = ctrl.root.querySelector('.jobs-row__applied') as HTMLButtonElement;
    btn.click();
    expect(hooks.onMarkStatus).toHaveBeenCalledWith('job-x', 'applied');
    expect(btn.disabled).toBe(true);
  });

  it('clicking "Dismiss" calls onMarkStatus(id, "rejected") and removes the row', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([makeJob({ id: 'job-y' })]));
    const btn = ctrl.root.querySelector('.jobs-row__dismiss') as HTMLButtonElement;
    btn.click();
    expect(hooks.onMarkStatus).toHaveBeenCalledWith('job-y', 'rejected');
    expect(ctrl.root.querySelectorAll('.jobs-row').length).toBe(0);
    expect((ctrl.root.querySelector('.jobs__empty') as HTMLElement).hidden).toBe(false);
  });

  it('clicking "Tailor resume" calls onTailorJob(job)', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    const job = makeJob({ id: 'job-z' });
    ctrl.applyDigestResult(makeResult([job]));
    (ctrl.root.querySelector('.jobs-row__tailor') as HTMLButtonElement).click();
    expect(hooks.onTailorJob).toHaveBeenCalledTimes(1);
    expect(hooks.onTailorJob.mock.calls[0][0].id).toBe('job-z');
  });

  it('clicking "Refresh digest" calls onRunDigest with the current control values', async () => {
    hooks.onRunDigest.mockResolvedValue({ ok: true, result: makeResult([makeJob()]) });
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    (ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(hooks.onRunDigest).toHaveBeenCalledTimes(1);
    const arg = hooks.onRunDigest.mock.calls[0][0];
    expect(arg.maxDaysOld).toBe(7);
    expect(arg.topN).toBe(10);
    expect(arg.fitScoreModel).toBeUndefined();
  });

  it('Refresh digest renders the returned jobs + footer summary', async () => {
    hooks.onRunDigest.mockResolvedValue({ ok: true, result: makeResult([makeJob({ id: 'r1' }), makeJob({ id: 'r2' })], { discoveredCount: 99 }) });
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    (ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.root.querySelectorAll('.jobs-row').length).toBe(2);
    const footer = ctrl.root.querySelector('.jobs__footer') as HTMLElement;
    expect(footer.hidden).toBe(false);
    expect(footer.textContent).toContain('99 found');
    expect(footer.textContent).toContain('2 shown');
    expect(footer.textContent).toContain('$0.0123');
  });

  it('Refresh digest surfaces an error message in the status line', async () => {
    hooks.onRunDigest.mockResolvedValue({ ok: false, message: 'sources not configured' });
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    (ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const status = ctrl.root.querySelector('.jobs__status') as HTMLElement;
    expect(status.textContent).toContain('sources not configured');
    expect(status.classList.contains('jobs__status--error')).toBe(true);
  });

  it('AI fit-score checkbox enables the model select and passes fitScoreModel to onRunDigest', async () => {
    hooks.onRunDigest.mockResolvedValue({ ok: true, result: makeResult([]) });
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    const cb = ctrl.root.querySelector('.jobs__fit-checkbox') as HTMLInputElement;
    const modelSel = ctrl.root.querySelector('.jobs__fit-model') as HTMLSelectElement;
    expect(modelSel.disabled).toBe(true);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(modelSel.disabled).toBe(false);
    (ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(hooks.onRunDigest.mock.calls[0][0].fitScoreModel).toBeTruthy();
  });

  it('clicking "Re-extract profile" calls onExtractProfile and caches the returned profile', async () => {
    const profile: JobProfile = {
      titles: ['Engineer'], seniority: 'senior', skills: ['Python'], domains: ['SaaS'],
      searchQueries: ['python engineer'], filters: { remote: 'any', minSalary: null, locations: [] },
      summary: 'A profile.',
    };
    hooks.onExtractProfile.mockResolvedValue({ ok: true, profile });
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    (ctrl.root.querySelector('.jobs__reextract') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(hooks.onExtractProfile).toHaveBeenCalledTimes(1);
    expect(ctrl.getProfile()).toEqual(profile);
  });

  it('with no hooks wired, the action buttons and refresh no-op without throwing', () => {
    const ctrl = renderJobsTab(); // no hooks at all
    ctrl.applyDigestResult(makeResult([makeJob()]));
    expect(() => {
      (ctrl.root.querySelector('.jobs-row__summary') as HTMLElement).click();
      (ctrl.root.querySelector('.jobs-row__tailor') as HTMLButtonElement).click();
      (ctrl.root.querySelector('.jobs-row__applied') as HTMLButtonElement).click();
      (ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement).click();
      (ctrl.root.querySelector('.jobs__reextract') as HTMLButtonElement).click();
    }).not.toThrow();
    // Dismiss still removes the row even without a hook.
    (ctrl.root.querySelector('.jobs-row__dismiss') as HTMLButtonElement).click();
    expect(ctrl.root.querySelectorAll('.jobs-row').length).toBe(0);
  });

  it('setBusy toggles the Refresh button and status text', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    const refreshBtn = ctrl.root.querySelector('.jobs__refresh') as HTMLButtonElement;
    const status = ctrl.root.querySelector('.jobs__status') as HTMLElement;
    ctrl.setBusy(true, 'Fetching…');
    expect(refreshBtn.disabled).toBe(true);
    expect(status.textContent).toBe('Fetching…');
    ctrl.setBusy(false);
    expect(refreshBtn.disabled).toBe(false);
    expect(status.textContent).toBe('');
  });

  it('setProfile updates the cached profile read by getProfile', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    const p: JobProfile = {
      titles: ['Dev'], seniority: 'mid', skills: [], domains: [], searchQueries: [],
      filters: { remote: 'any', minSalary: null, locations: [] }, summary: '',
    };
    ctrl.setProfile(p);
    expect(ctrl.getProfile()).toEqual(p);
  });

  it('applyDigestResult with an empty job list shows a "no matching jobs" message', () => {
    const ctrl = renderJobsTab(hooks as unknown as JobsTabHooks);
    ctrl.applyDigestResult(makeResult([]));
    const empty = ctrl.root.querySelector('.jobs__empty') as HTMLElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent?.toLowerCase()).toContain('no matching jobs');
    expect((ctrl.root.querySelector('.jobs__footer') as HTMLElement).hidden).toBe(false);
  });
});
