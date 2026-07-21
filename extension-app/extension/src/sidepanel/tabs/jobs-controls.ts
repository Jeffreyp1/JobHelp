/**
 * Jobs tab — the header control strip (Refresh button, status line,
 * posting-age and top-N selects, AI-fit-score toggle, Re-extract link) and the
 * filter state those controls drive. Extracted from jobs.ts to keep each
 * module focused and within the file-size budget.
 */
import { el } from './jobs-row.js';

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

/** Mutable filter state shared between the header controls and a digest run. */
export interface JobsControlsState {
  maxDaysOld: number;
  topN: number;
  useFitScore: boolean;
  fitScoreModel: string;
}

/** The default control state for a freshly-opened Jobs tab. */
export function createControlsState(): JobsControlsState {
  return { maxDaysOld: 7, topN: 10, useFitScore: false, fitScoreModel: HAIKU };
}

export interface JobsHeader {
  header: HTMLElement;
  refreshBtn: HTMLButtonElement;
  reExtractLink: HTMLButtonElement;
  importBtn: HTMLButtonElement;
  importFileInput: HTMLInputElement;
  statusEl: HTMLElement;
}

/**
 * Build the Jobs tab header. The select / checkbox controls write directly
 * into `state`; the caller wires click behaviour onto the returned buttons.
 */
export function buildJobsHeader(state: JobsControlsState): JobsHeader {
  const header = el('div', 'jobs__header');

  const refreshBtn = el('button', 'btn btn-primary jobs__refresh', 'Refresh digest');
  refreshBtn.type = 'button';
  header.appendChild(refreshBtn);

  const statusEl = el('span', 'jobs__status');
  header.appendChild(statusEl);

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

  const reExtractLink = el('button', 'btn btn-ghost jobs__reextract', 'Re-extract profile');
  reExtractLink.type = 'button';
  header.appendChild(reExtractLink);

  const importBtn = el('button', 'btn btn-ghost jobs__import', 'Import digest file');
  importBtn.type = 'button';
  header.appendChild(importBtn);

  const importFileInput = document.createElement('input');
  importFileInput.type = 'file';
  importFileInput.accept = 'application/json,.json';
  importFileInput.hidden = true;
  header.appendChild(importFileInput);

  return { header, refreshBtn, reExtractLink, importBtn, importFileInput, statusEl };
}
