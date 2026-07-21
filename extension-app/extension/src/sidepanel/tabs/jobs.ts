/**
 * Jobs tab — the Phase-1 daily-digest UI for the job-discovery pipeline.
 *
 * Layout (top → bottom):
 *   1. Header row: "Refresh digest" button + status line + the inline controls
 *      (posted-within-N-days, show-top-N, use-AI-fit-score + model) + a
 *      "Re-extract profile" link.
 *   2. The ranked job list — one row per RankedJob; clicking a row expands it
 *      to show matched/missing skill chips, a JD snippet, and an action bar.
 *   3. A footer line summarising the last digest run (counts + cost).
 *
 * Pure DOM. All backend access goes through the parent-supplied hooks
 * (sidepanel/index.ts wires them to the ApiClient). Every hook is optional —
 * an unwired hook makes the corresponding control a graceful no-op. The header
 * controls live in `jobs-controls.ts`; row/list rendering in `jobs-row.ts`.
 */

import type { DiscoverAndRankResult } from '../../types/api-contract.js';
import type { RankedJob, JobProfile, JobPipelineStatus } from '../../types/job-discovery.js';
import { el, renderJobList, type JobListView } from './jobs-row.js';
import { buildJobsHeader, createControlsState } from './jobs-controls.js';
import { importDigestText, DigestImportError } from '../../lib/digestImport.js';
import { saveDigest } from '../../lib/digestCache.js';

/** Result envelope the parent hooks return — a digest payload or an error message. */
export type DigestHookResult =
  | { ok: true; result: DiscoverAndRankResult }
  | { ok: false; message: string };

export type ExtractProfileHookResult =
  | { ok: true; profile: JobProfile }
  | { ok: false; message: string };

export interface JobsTabHooks {
  /**
   * A digest result restored from chrome.storage on panel open. When present,
   * the tab renders its rows immediately and the footer is marked as restored
   * (with the result's age) until the user runs a fresh digest.
   */
  initialResult?: { result: DiscoverAndRankResult; savedAt: number };
  /** Run a discovery + ranking pass. The parent assembles the request. */
  onRunDigest?: (opts: {
    maxDaysOld: number;
    topN: number;
    fitScoreModel?: string;
  }) => Promise<DigestHookResult>;
  /** (Re-)extract the user's JobProfile from their source materials. */
  onExtractProfile?: () => Promise<ExtractProfileHookResult>;
  /** Kick the existing generate flow for one ranked job ("Tailor resume"). */
  onTailorJob?: (job: RankedJob) => Promise<void> | void;
  /** Update a Job Pipeline row's status (and optionally its tailored-doc URL). */
  onMarkStatus?: (
    jobId: string,
    status: JobPipelineStatus,
    tailoredDocUrl?: string,
  ) => Promise<void> | void;
}

export interface JobsTabController {
  root: HTMLElement;
  /** Render the ranked rows + footer summary from a fresh digest result. */
  applyDigestResult(result: DiscoverAndRankResult): void;
  /** Toggle the Refresh button + status text. */
  setBusy(busy: boolean, label?: string): void;
  /** The currently-cached JobProfile (set by `setProfile`), or null. */
  getProfile(): JobProfile | null;
  /** Adopt a cached/extracted profile (used by the parent after `onExtractProfile`). */
  setProfile(profile: JobProfile | null): void;
}

export function renderJobsTab(hooks: JobsTabHooks = {}): JobsTabController {
  const root = el('section', 'tab-pane tab-pane--jobs');

  let profile: JobProfile | null = null;
  const state = createControlsState();

  // ─── 1. Header row ────────────────────────────────────────────────
  const { header, refreshBtn, reExtractLink, importBtn, importFileInput, statusEl } =
    buildJobsHeader(state);
  root.appendChild(header);

  // ─── 2. Ranked job list ──────────────────────────────────────────
  const listEl = el('ul', 'jobs__list');
  root.appendChild(listEl);

  const emptyEl = el('p', 'jobs__empty', 'No jobs yet — click Refresh digest.');
  root.appendChild(emptyEl);

  // ─── 3. Footer summary ───────────────────────────────────────────
  const footerEl = el('div', 'jobs__footer');
  footerEl.hidden = true;
  root.appendChild(footerEl);

  // ─── Behaviour ───────────────────────────────────────────────────
  function setBusy(busy: boolean, label?: string): void {
    refreshBtn.disabled = busy;
    reExtractLink.disabled = busy;
    if (busy) {
      statusEl.textContent = label ?? 'Working…';
      statusEl.className = 'jobs__status jobs__status--working';
    } else if (statusEl.classList.contains('jobs__status--working')) {
      statusEl.textContent = '';
      statusEl.className = 'jobs__status';
    }
  }

  function showError(message: string): void {
    statusEl.textContent = message;
    statusEl.className = 'jobs__status jobs__status--error';
  }

  function showInfo(message: string): void {
    statusEl.textContent = message;
    statusEl.className = 'jobs__status';
  }

  const view: JobListView = {
    listEl,
    emptyEl,
    footerEl,
    showError,
    onTailorJob: hooks.onTailorJob,
    onMarkStatus: hooks.onMarkStatus,
  };

  async function runDigest(): Promise<void> {
    if (!hooks.onRunDigest) {
      showError('Discovery sources not configured — set them in Settings.');
      return;
    }
    setBusy(true, 'Fetching digest…');
    try {
      const outcome = await hooks.onRunDigest({
        maxDaysOld: state.maxDaysOld,
        topN: state.topN,
        fitScoreModel: state.useFitScore ? state.fitScoreModel : undefined,
      });
      if (!outcome.ok) {
        showError(outcome.message);
        return;
      }
      renderJobList(outcome.result, undefined, view);
      showInfo('');
    } catch (e) {
      showError(`Digest failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function reExtractProfile(): Promise<void> {
    if (!hooks.onExtractProfile) {
      showError('Discovery sources not configured — set them in Settings.');
      return;
    }
    setBusy(true, 'Extracting profile…');
    try {
      const outcome = await hooks.onExtractProfile();
      if (!outcome.ok) {
        showError(outcome.message);
        return;
      }
      profile = outcome.profile;
      showInfo('Profile extracted.');
    } catch (e) {
      showError(`Profile extraction failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function importDigestFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      showError('Could not read the selected file.');
      return;
    }
    try {
      const result = importDigestText(text);
      renderJobList(result, undefined, view);
      void saveDigest(result);
      showInfo(`Imported ${result.jobs.length} jobs.`);
    } catch (e) {
      if (e instanceof DigestImportError) {
        showError(`Not a valid digest file: ${e.message}`);
        return;
      }
      throw e;
    }
  }

  refreshBtn.addEventListener('click', () => void runDigest());
  reExtractLink.addEventListener('click', () => void reExtractProfile());
  importBtn.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files?.[0];
    importFileInput.value = '';
    if (file) void importDigestFile(file);
  });

  if (hooks.initialResult) {
    renderJobList(hooks.initialResult.result, hooks.initialResult.savedAt, view);
  }

  return {
    root,
    applyDigestResult: (result) => renderJobList(result, undefined, view),
    setBusy,
    getProfile: () => profile,
    setProfile: (p) => {
      profile = p;
    },
  };
}
