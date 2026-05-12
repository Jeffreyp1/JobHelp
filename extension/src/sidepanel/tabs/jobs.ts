/**
 * Jobs tab — the Phase-1 daily-digest UI for the job-discovery pipeline.
 *
 * Layout (top → bottom):
 *   1. Header row: "Refresh digest" button + status line + the inline controls
 *      (posted-within-N-days, show-top-N, use-AI-fit-score + model) + a
 *      "Re-extract profile" link.
 *   2. The ranked job list — one row per RankedJob; clicking a row expands it
 *      to show matched/missing skill chips, a JD snippet, and an action bar
 *      (Open posting / Tailor resume / Mark applied / Dismiss).
 *   3. A footer line summarising the last digest run (counts + cost).
 *
 * Pure DOM. All backend access goes through the parent-supplied hooks
 * (sidepanel/index.ts wires them to the ApiClient). Every hook is optional —
 * an unwired hook makes the corresponding control a graceful no-op, mirroring
 * the Generate tab's v2 hook pattern.
 */

import type { DiscoverAndRankResult } from '../../types/api-contract.js';
import type {
  RankedJob,
  JobProfile,
  JobPipelineStatus,
} from '../../types/job-discovery.js';

/** Result envelope the parent hooks return — a digest payload or an error message. */
export type DigestHookResult =
  | { ok: true; result: DiscoverAndRankResult }
  | { ok: false; message: string };

export type ExtractProfileHookResult =
  | { ok: true; profile: JobProfile }
  | { ok: false; message: string };

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';
const FIT_MODELS = [HAIKU, SONNET, OPUS];

const DAYS_OPTIONS = [
  { value: 1, label: 'past 24h' },
  { value: 3, label: 'past 3 days' },
  { value: 7, label: 'past 7 days' },
  { value: 14, label: 'past 14 days' },
  { value: 30, label: 'past 30 days' },
  { value: 0, label: 'any age' },
];
const TOPN_OPTIONS = [5, 10, 20, 40];

export interface JobsTabHooks {
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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "posted N days ago" / "posted today" / "posting date unknown". */
function formatPostedAge(postedAt: number | null): string {
  if (postedAt === null || !Number.isFinite(postedAt)) return 'posting date unknown';
  const diffDays = Math.floor((Date.now() - postedAt) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'posting date unknown';
  if (diffDays === 0) return 'posted today';
  if (diffDays === 1) return 'posted 1 day ago';
  return `posted ${diffDays} days ago`;
}

/** 0..1 finalScore → "73%". */
function formatScore(n: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, n)) * 100);
  return `${pct}%`;
}

function buildChip(text: string, muted = false): HTMLElement {
  const chip = el('span', `jobs-chip${muted ? ' jobs-chip--muted' : ''}`, text);
  return chip;
}

export function renderJobsTab(hooks: JobsTabHooks = {}): JobsTabController {
  const root = el('section', 'tab-pane tab-pane--jobs');

  let profile: JobProfile | null = null;
  const state = {
    maxDaysOld: 7,
    topN: 10,
    useFitScore: false,
    fitScoreModel: HAIKU,
  };

  // ─── 1. Header row ────────────────────────────────────────────────
  const header = el('div', 'jobs__header');

  const refreshBtn = el('button', 'btn btn-primary jobs__refresh', 'Refresh digest');
  refreshBtn.type = 'button';
  header.appendChild(refreshBtn);

  const statusEl = el('span', 'jobs__status');
  header.appendChild(statusEl);

  // posted-within-N-days select
  const daysSelect = document.createElement('select');
  daysSelect.className = 'jobs__days-select';
  daysSelect.setAttribute('aria-label', 'Maximum posting age');
  for (const opt of DAYS_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (opt.value === state.maxDaysOld) o.selected = true;
    daysSelect.appendChild(o);
  }
  daysSelect.addEventListener('change', () => {
    state.maxDaysOld = Number(daysSelect.value);
  });
  header.appendChild(daysSelect);

  // show-top-N select
  const topNSelect = document.createElement('select');
  topNSelect.className = 'jobs__topn-select';
  topNSelect.setAttribute('aria-label', 'How many jobs to show');
  for (const n of TOPN_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `top ${n}`;
    if (n === state.topN) o.selected = true;
    topNSelect.appendChild(o);
  }
  topNSelect.addEventListener('change', () => {
    state.topN = Number(topNSelect.value);
  });
  header.appendChild(topNSelect);

  // use-AI-fit-score checkbox + model select
  const fitWrap = el('label', 'jobs__fit');
  const fitCheckbox = document.createElement('input');
  fitCheckbox.type = 'checkbox';
  fitCheckbox.className = 'jobs__fit-checkbox';
  fitCheckbox.checked = state.useFitScore;
  fitWrap.appendChild(fitCheckbox);
  fitWrap.appendChild(document.createTextNode(' AI fit-score'));
  const fitModelSelect = document.createElement('select');
  fitModelSelect.className = 'jobs__fit-model';
  fitModelSelect.setAttribute('aria-label', 'Fit-score model');
  for (const m of FIT_MODELS) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    if (m === state.fitScoreModel) o.selected = true;
    fitModelSelect.appendChild(o);
  }
  fitModelSelect.disabled = !state.useFitScore;
  fitCheckbox.addEventListener('change', () => {
    state.useFitScore = fitCheckbox.checked;
    fitModelSelect.disabled = !state.useFitScore;
  });
  fitModelSelect.addEventListener('change', () => {
    state.fitScoreModel = fitModelSelect.value;
  });
  fitWrap.appendChild(fitModelSelect);
  header.appendChild(fitWrap);

  // Re-extract profile link
  const reExtractLink = el('button', 'btn btn-ghost jobs__reextract', 'Re-extract profile');
  reExtractLink.type = 'button';
  header.appendChild(reExtractLink);

  root.appendChild(header);

  // ─── 2. Ranked job list ──────────────────────────────────────────
  const listEl = el('ul', 'jobs__list');
  root.appendChild(listEl);

  const emptyEl = el(
    'p',
    'jobs__empty',
    'No jobs yet — click Refresh digest.',
  );
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
      applyDigestResult(outcome.result);
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

  refreshBtn.addEventListener('click', () => void runDigest());
  reExtractLink.addEventListener('click', () => void reExtractProfile());

  function applyDigestResult(result: DiscoverAndRankResult): void {
    listEl.replaceChildren();
    const jobs = result.jobs ?? [];
    if (jobs.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'No matching jobs in this digest.';
    } else {
      emptyEl.hidden = true;
      for (const job of jobs) {
        listEl.appendChild(renderJobRow(job));
      }
    }
    footerEl.hidden = false;
    const cost = result.cost?.totalUsd ?? 0;
    footerEl.textContent = `Last digest: ${result.discoveredCount} found, ${jobs.length} shown · cost $${cost.toFixed(4)}`;
  }

  function renderJobRow(job: RankedJob): HTMLElement {
    const li = el('li', 'jobs-row');
    li.dataset.jobId = job.id;

    // ── Summary line (always visible, click to expand) ──
    const summary = el('div', 'jobs-row__summary');
    summary.setAttribute('role', 'button');
    summary.tabIndex = 0;

    const titleParts: string[] = [];
    if (job.company) titleParts.push(job.company);
    if (job.title) titleParts.push(job.title);
    if (job.location) titleParts.push(job.location);
    summary.appendChild(el('span', 'jobs-row__title', titleParts.join(' · ')));
    summary.appendChild(el('span', 'jobs-row__age', formatPostedAge(job.postedAt)));

    const badge = el('span', 'jobs-row__score', formatScore(job.finalScore));
    badge.setAttribute('aria-label', `fit score ${formatScore(job.finalScore)}`);
    summary.appendChild(badge);

    summary.appendChild(el('span', 'jobs-row__source', job.source));
    li.appendChild(summary);

    // ── Expanded detail (hidden until clicked) ──
    const detail = el('div', 'jobs-row__detail');
    detail.hidden = true;

    if (job.matchedSkills && job.matchedSkills.length) {
      const matchedWrap = el('div', 'jobs-row__skills jobs-row__skills--matched');
      matchedWrap.appendChild(el('span', 'jobs-row__skills-label', 'Matched: '));
      for (const s of job.matchedSkills) matchedWrap.appendChild(buildChip(s, false));
      detail.appendChild(matchedWrap);
    }
    if (job.missingSkills && job.missingSkills.length) {
      const missingWrap = el('div', 'jobs-row__skills jobs-row__skills--missing');
      missingWrap.appendChild(el('span', 'jobs-row__skills-label', 'Missing: '));
      for (const s of job.missingSkills) missingWrap.appendChild(buildChip(s, true));
      detail.appendChild(missingWrap);
    }

    const snippet = (job.descriptionText ?? '').slice(0, 400);
    if (snippet) {
      const snippetEl = el('p', 'jobs-row__snippet');
      snippetEl.textContent = snippet + (job.descriptionText && job.descriptionText.length > 400 ? '…' : '');
      detail.appendChild(snippetEl);
    }

    // Action bar
    const actions = el('div', 'jobs-row__actions');

    const openLink = el('a', 'btn btn-ghost jobs-row__open', 'Open posting');
    openLink.href = job.url;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    actions.appendChild(openLink);

    const tailorBtn = el('button', 'btn btn-secondary jobs-row__tailor', 'Tailor resume');
    tailorBtn.type = 'button';
    tailorBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!hooks.onTailorJob) {
        showError('Generate not available — run setup in Settings first.');
        return;
      }
      void hooks.onTailorJob(job);
    });
    actions.appendChild(tailorBtn);

    const appliedBtn = el('button', 'btn btn-secondary jobs-row__applied', 'Mark applied');
    appliedBtn.type = 'button';
    appliedBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!hooks.onMarkStatus) {
        showError('Pipeline sheet not configured — run setup in Settings first.');
        return;
      }
      void hooks.onMarkStatus(job.id, 'applied');
      appliedBtn.textContent = 'Applied ✓';
      appliedBtn.disabled = true;
    });
    actions.appendChild(appliedBtn);

    const dismissBtn = el('button', 'btn btn-ghost jobs-row__dismiss', 'Dismiss');
    dismissBtn.type = 'button';
    dismissBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (hooks.onMarkStatus) void hooks.onMarkStatus(job.id, 'rejected');
      li.remove();
      if (!listEl.querySelector('.jobs-row')) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'No jobs left in this digest.';
      }
    });
    actions.appendChild(dismissBtn);

    detail.appendChild(actions);
    li.appendChild(detail);

    function toggleExpand(): void {
      const willExpand = detail.hidden;
      detail.hidden = !willExpand;
      li.classList.toggle('jobs-row--expanded', willExpand);
    }
    summary.addEventListener('click', toggleExpand);
    summary.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggleExpand();
      }
    });

    return li;
  }

  return {
    root,
    applyDigestResult,
    setBusy,
    getProfile: () => profile,
    setProfile: (p) => {
      profile = p;
    },
  };
}
