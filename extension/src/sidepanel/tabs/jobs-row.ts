/**
 * Jobs tab — job-list and job-row rendering. Extracted from jobs.ts so the
 * tab module stays within the file-size budget. Pure DOM; the closure
 * dependencies a row needs are passed in via {@link JobListView}.
 */
import type { DiscoverAndRankResult } from '../../types/api-contract.js';
import type { RankedJob, JobPipelineStatus } from '../../types/job-discovery.js';

/** Dependencies the list/row renderers need from the surrounding Jobs tab. */
export interface JobListView {
  listEl: HTMLElement;
  emptyEl: HTMLElement;
  footerEl: HTMLElement;
  showError(message: string): void;
  onTailorJob?: (job: RankedJob) => Promise<void> | void;
  onMarkStatus?: (
    jobId: string,
    status: JobPipelineStatus,
    tailoredDocUrl?: string,
  ) => Promise<void> | void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
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

/** Epoch ms → "just now" / "3h ago" / "2 days ago" for a restored digest. */
function formatDigestAge(savedAt: number): string {
  if (!Number.isFinite(savedAt)) return 'unknown age';
  const diffMs = Date.now() - savedAt;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / (1000 * 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** 0..1 finalScore → "73%". */
function formatScore(n: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, n)) * 100);
  return `${pct}%`;
}

function buildChip(text: string, muted = false): HTMLElement {
  return el('span', `jobs-chip${muted ? ' jobs-chip--muted' : ''}`, text);
}

/** Render one ranked-job row: a summary line plus an expandable detail panel. */
function renderJobRow(job: RankedJob, view: JobListView): HTMLElement {
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
    snippetEl.textContent =
      snippet + (job.descriptionText && job.descriptionText.length > 400 ? '…' : '');
    detail.appendChild(snippetEl);
  }

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
    if (!view.onTailorJob) {
      view.showError('Generate not available — run setup in Settings first.');
      return;
    }
    void view.onTailorJob(job);
  });
  actions.appendChild(tailorBtn);

  const appliedBtn = el('button', 'btn btn-secondary jobs-row__applied', 'Mark applied');
  appliedBtn.type = 'button';
  appliedBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!view.onMarkStatus) {
      view.showError('Pipeline sheet not configured — run setup in Settings first.');
      return;
    }
    void view.onMarkStatus(job.id, 'applied');
    appliedBtn.textContent = 'Applied ✓';
    appliedBtn.disabled = true;
  });
  actions.appendChild(appliedBtn);

  const dismissBtn = el('button', 'btn btn-ghost jobs-row__dismiss', 'Dismiss');
  dismissBtn.type = 'button';
  dismissBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (view.onMarkStatus) void view.onMarkStatus(job.id, 'rejected');
    li.remove();
    if (!view.listEl.querySelector('.jobs-row')) {
      view.emptyEl.hidden = false;
      view.emptyEl.textContent = 'No jobs left in this digest.';
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

/**
 * Render the ranked rows + footer summary into the view. Pass `restoredAt`
 * (epoch ms) to mark the footer as a restored digest with its age; omit it
 * for a fresh run.
 */
export function renderJobList(
  result: DiscoverAndRankResult,
  restoredAt: number | undefined,
  view: JobListView,
): void {
  view.listEl.replaceChildren();
  const jobs = result.jobs ?? [];
  if (jobs.length === 0) {
    view.emptyEl.hidden = false;
    view.emptyEl.textContent = 'No matching jobs in this digest.';
  } else {
    view.emptyEl.hidden = true;
    for (const job of jobs) {
      view.listEl.appendChild(renderJobRow(job, view));
    }
  }
  view.footerEl.hidden = false;
  const cost = result.cost?.totalUsd ?? 0;
  const summary = `Last digest: ${result.discoveredCount} found, ${jobs.length} shown · cost $${cost.toFixed(4)}`;
  view.footerEl.textContent =
    restoredAt !== undefined
      ? `Restored — last refreshed ${formatDigestAge(restoredAt)} · ${summary}`
      : summary;
}
