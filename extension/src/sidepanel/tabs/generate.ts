/**
 * Generate tab — the primary workflow surface.
 *
 * Layout (top → bottom):
 *   1. Job Insights card (auto-populated from the latest scrape)
 *   2. Editable Company / Role / URL inputs
 *   3. JD textarea with live token count
 *   4. Toggle UI shell — only "Generate" is active in v1; the rest are
 *      shown as disabled with "coming vX" badges.
 *   5. Live cost estimator (recomputes on toggle change)
 *   6. [Generate] button
 *   7. Resume editor (rendered after a successful response)
 *
 * Pure DOM. State is owned by the function-level closure; the parent
 * (sidepanel/index.ts) wires up scraper-result events by calling
 * `applyScraperOutput()` on the returned controller.
 */

import { renderJobInsightsCard } from '../components/jobInsights.js';
import { renderToggleRow } from '../components/toggleRow.js';
import { renderCostEstimator } from '../components/costEstimator.js';
import { renderResumeEditor } from '../components/resumeEditor.js';
import { estimateCost } from '../../lib/costCalculator.js';
import { formatTokens } from '../../lib/tokenFormatter.js';
import { get, set } from '../../lib/storage.js';
import type { ScraperOutput } from '../../types/scraper-output.js';
import type { ToggleConfig, GenerateRequest, FinalizeFormat } from '../../types/api-contract.js';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';
const ALL_MODELS = [HAIKU, SONNET, OPUS];

/** Rough chars-per-token approximation for the live token count. */
function approxTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4));
}

/**
 * Extract a Google Doc ID from a Docs URL.
 * e.g. https://docs.google.com/document/d/abc123xyz/edit → "abc123xyz"
 */
export function extractDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([\w-]+)/);
  return m ? m[1] : null;
}

/**
 * Extract a Google Drive folder ID from a Drive folders URL.
 * e.g. https://drive.google.com/drive/folders/folder456xyz → "folder456xyz"
 */
export function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([\w-]+)/);
  return m ? m[1] : null;
}

/**
 * Extract a Drive file ID from a generic Drive file URL like
 * https://drive.google.com/file/d/{id}/view or .../edit.
 */
export function extractFileIdFromUrl(url: string): string | null {
  const m = url.match(/\/file\/d\/([\w-]+)/) ?? url.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : null;
}

export interface GenerateTabController {
  root: HTMLElement;
  applyScraperOutput(output: ScraperOutput): void;
  showResume(md: string): void;
  /** Show resume after a successful generate; also unlocks the finalize section. */
  showGenerateResult(md: string, docUrl: string, jobFolderUrl: string): void;
  setBusy(busy: boolean, label?: string): void;
}

export interface FinalizeRequest {
  format: FinalizeFormat;
  markdown: string;
  docId: string;
  jobFolderId: string;
}

export interface GenerateTabHooks {
  /** Invoked when the user clicks the Generate button. */
  onGenerate: (req: Omit<GenerateRequest, 'action'>) => void | Promise<void>;
  /** Invoked when the user clicks Save & Log on the resume editor. */
  onSaveResume: (md: string) => void | Promise<void>;
  /**
   * Invoked when the user clicks Convert to PDF or Convert to DOCX.
   * Should call apiClient.finalize and return the result.
   */
  onFinalize: (req: FinalizeRequest) => Promise<{ ok: true; url: string; fileName: string } | { ok: false; message: string }>;
  /**
   * Invoked when the user clicks "Convert via Template (DOCX)".
   * The hook handles: fetching the user's template, parsing markdown,
   * filling, and uploading to Drive. Returns the resulting file URL or an
   * error message for surface-level display.
   */
  onConvertViaTemplate?: (req: {
    markdown: string;
    jobFolderId: string;
  }) => Promise<{ ok: true; url: string; fileName: string; fileId?: string } | { ok: false; message: string }>;
}

export function renderGenerateTab(hooks: GenerateTabHooks): GenerateTabController {
  const root = document.createElement('section');
  root.className = 'tab-pane tab-pane--generate';

  // Mutable state (closed over by event handlers).
  const state = {
    company: null as string | null,
    role: null as string | null,
    url: '',
    jd: '',
    scraperOutput: null as ScraperOutput | null,
    generateModel: HAIKU,
    toggles: {} as ToggleConfig,
    // Populated after a successful generate; needed by finalize.
    docId: null as string | null,
    jobFolderId: null as string | null,
  };

  // Reference to the resume editor's textarea so finalize can read the
  // current (potentially user-edited) markdown.
  let currentMarkdownGetter: (() => string) | null = null;

  // ─── 1. Job Insights card ─────────────────────────────────────────
  const insightsContainer = document.createElement('div');
  insightsContainer.className = 'generate__insights';
  insightsContainer.appendChild(renderJobInsightsCard(null));
  root.appendChild(insightsContainer);

  // ─── 2. Company / Role / URL inputs ──────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'generate__meta';
  meta.appendChild(makeFieldRow('Company', 'text', '', (v) => (state.company = v || null)));
  meta.appendChild(makeFieldRow('Role', 'text', '', (v) => (state.role = v || null)));
  meta.appendChild(makeFieldRow('URL', 'url', '', (v) => (state.url = v)));
  root.appendChild(meta);

  // ─── 3. JD textarea ───────────────────────────────────────────────
  const jdWrap = document.createElement('div');
  jdWrap.className = 'generate__jd';
  const jdLabel = document.createElement('label');
  jdLabel.className = 'generate__jd-label';
  jdLabel.textContent = 'Job description';
  const jdTextarea = document.createElement('textarea');
  jdTextarea.className = 'generate__jd-textarea';
  jdTextarea.placeholder = 'Paste JD here, or open a job posting and let the scraper fill it in.';
  jdTextarea.rows = 8;
  const jdMeta = document.createElement('div');
  jdMeta.className = 'generate__jd-meta';
  const jdTokensSpan = document.createElement('span');
  jdTokensSpan.className = 'generate__jd-tokens';
  jdTokensSpan.textContent = formatTokens(0);
  jdMeta.appendChild(jdTokensSpan);
  jdTextarea.addEventListener('input', () => {
    state.jd = jdTextarea.value;
    jdTokensSpan.textContent = formatTokens(approxTokens(jdTextarea.value));
  });
  jdWrap.appendChild(jdLabel);
  jdWrap.appendChild(jdTextarea);
  jdWrap.appendChild(jdMeta);
  root.appendChild(jdWrap);

  // ─── 4. Toggle UI shell ──────────────────────────────────────────
  const togglesBlock = document.createElement('div');
  togglesBlock.className = 'generate__toggles';
  const togglesTitle = document.createElement('h3');
  togglesTitle.className = 'generate__toggles-title';
  togglesTitle.textContent = 'Pipeline';
  togglesBlock.appendChild(togglesTitle);

  // Generate is always on; user can swap the model.
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Generate Resume',
      enabled: true,
      disabled: false,
      models: ALL_MODELS,
      selectedModel: state.generateModel,
      onModelChange: (m) => {
        state.generateModel = m;
        renderCostBlock();
      },
    }),
  );

  // Disabled toggles (placeholders).
  const disabledToggles: Array<{ label: string; comingIn: 'v2' | 'v3' | 'v4' | 'v5' }> = [
    { label: 'Research', comingIn: 'v3' },
    { label: 'LinkedIn benchmarking', comingIn: 'v3' },
    { label: 'Critique pass', comingIn: 'v2' },
    { label: 'Auto-revise', comingIn: 'v2' },
    { label: 'Multi-version', comingIn: 'v5' },
    { label: 'Cover letter', comingIn: 'v4' },
    { label: 'Verify CL hooks', comingIn: 'v4' },
  ];
  for (const t of disabledToggles) {
    togglesBlock.appendChild(
      renderToggleRow({
        label: t.label,
        enabled: false,
        disabled: true,
        comingIn: t.comingIn,
      }),
    );
  }
  root.appendChild(togglesBlock);

  // ─── 5. Cost estimator (re-renderable) ──────────────────────────
  const costContainer = document.createElement('div');
  costContainer.className = 'generate__cost';
  function renderCostBlock() {
    costContainer.replaceChildren(
      renderCostEstimator(estimateCost(state.toggles, state.generateModel)),
    );
  }
  renderCostBlock();
  root.appendChild(costContainer);

  // ─── 6. Generate button + status ────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'generate__actions';
  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.className = 'btn btn-primary generate__btn';
  generateBtn.textContent = 'Generate';
  const statusEl = document.createElement('span');
  statusEl.className = 'generate__status';
  actions.appendChild(generateBtn);
  actions.appendChild(statusEl);
  root.appendChild(actions);

  // ─── 7. Resume editor slot (populated after response) ─────────
  const resumeSlot = document.createElement('div');
  resumeSlot.className = 'generate__resume';
  root.appendChild(resumeSlot);

  // ─── 8. Finalize section (hidden until generate succeeds) ────
  const finalizeSection = document.createElement('section');
  finalizeSection.className = 'generate__finalize';
  finalizeSection.hidden = true;
  finalizeSection.setAttribute('aria-label', 'Convert to final format');

  const finalizeHeading = document.createElement('h3');
  finalizeHeading.className = 'generate__finalize-heading';
  finalizeHeading.textContent = 'Convert to final format';
  finalizeSection.appendChild(finalizeHeading);

  const finalizeButtons = document.createElement('div');
  finalizeButtons.className = 'generate__finalize-buttons';

  const pdfBtn = document.createElement('button');
  pdfBtn.type = 'button';
  pdfBtn.className = 'btn btn-secondary generate__finalize-btn generate__finalize-btn--pdf';
  pdfBtn.textContent = 'Convert to PDF';
  pdfBtn.disabled = true; // enabled once docId/jobFolderId are available

  const docxBtn = document.createElement('button');
  docxBtn.type = 'button';
  docxBtn.className = 'btn btn-secondary generate__finalize-btn generate__finalize-btn--docx';
  docxBtn.textContent = 'Convert to DOCX';
  docxBtn.disabled = true;

  const templateBtn = document.createElement('button');
  templateBtn.type = 'button';
  templateBtn.className =
    'btn btn-secondary generate__finalize-btn generate__finalize-btn--template';
  templateBtn.textContent = 'Convert via Template (DOCX)';
  templateBtn.disabled = true;
  templateBtn.title =
    'Fills your uploaded template (Settings → "Drive: template DOCX file ID") '
      + 'with the current resume markdown and saves it into the job folder.';

  finalizeButtons.appendChild(pdfBtn);
  finalizeButtons.appendChild(docxBtn);
  finalizeButtons.appendChild(templateBtn);
  finalizeSection.appendChild(finalizeButtons);

  const finalizeStatusEl = document.createElement('div');
  finalizeStatusEl.className = 'generate__finalize-status';
  finalizeSection.appendChild(finalizeStatusEl);

  root.appendChild(finalizeSection);

  /** Enable or disable finalize buttons based on whether IDs are present. */
  function updateFinalizeButtons(): void {
    const canFinalize = state.docId !== null && state.jobFolderId !== null;
    pdfBtn.disabled = !canFinalize;
    docxBtn.disabled = !canFinalize;
    // Template button only requires the job folder; it doesn't go through
    // the Doc export pipeline.
    templateBtn.disabled = state.jobFolderId === null || !hooks.onConvertViaTemplate;
    if (!canFinalize) {
      const tip = 'Not available — could not extract document IDs from generate result';
      pdfBtn.title = tip;
      docxBtn.title = tip;
    } else {
      pdfBtn.title = '';
      docxBtn.title = '';
    }
  }

  /** Show a Converting… spinner-like text, then on result show a link or error. */
  async function handleFinalizeClick(format: FinalizeFormat): Promise<void> {
    if (!state.docId || !state.jobFolderId) return;

    // Disable both buttons during the request
    pdfBtn.disabled = true;
    docxBtn.disabled = true;
    finalizeStatusEl.textContent = 'Converting…';
    finalizeStatusEl.className = 'generate__finalize-status generate__finalize-status--working';

    const markdown = currentMarkdownGetter ? currentMarkdownGetter() : '';

    const result = await hooks.onFinalize({
      format,
      markdown,
      docId: state.docId,
      jobFolderId: state.jobFolderId,
    });

    if (result.ok) {
      // Build a "Saved → [Open FILE]" success row
      const formatLabel = format.toUpperCase();
      const successRow = document.createElement('div');
      successRow.className = 'generate__finalize-result generate__finalize-result--ok';

      const savedText = document.createTextNode(`${formatLabel} saved → `);
      successRow.appendChild(savedText);

      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'generate__finalize-link';
      link.textContent = `Open ${result.fileName}`;
      successRow.appendChild(link);

      // Append (don't replace) so both PDF and DOCX results accumulate
      finalizeStatusEl.textContent = '';
      finalizeStatusEl.className = 'generate__finalize-status';
      finalizeStatusEl.appendChild(successRow);
    } else {
      finalizeStatusEl.textContent = `Error: ${result.message}`;
      finalizeStatusEl.className = 'generate__finalize-status generate__finalize-status--error';
    }

    // Re-enable buttons
    updateFinalizeButtons();
  }

  pdfBtn.addEventListener('click', () => void handleFinalizeClick('pdf'));
  docxBtn.addEventListener('click', () => void handleFinalizeClick('docx'));

  /** Run the template-fill pipeline, displaying status and a download link. */
  async function handleTemplateClick(): Promise<void> {
    if (!hooks.onConvertViaTemplate || !state.jobFolderId) return;
    pdfBtn.disabled = true;
    docxBtn.disabled = true;
    templateBtn.disabled = true;
    finalizeStatusEl.textContent = 'Filling template…';
    finalizeStatusEl.className = 'generate__finalize-status generate__finalize-status--working';

    const markdown = currentMarkdownGetter ? currentMarkdownGetter() : '';
    const result = await hooks.onConvertViaTemplate({
      markdown,
      jobFolderId: state.jobFolderId,
    });

    if (result.ok) {
      finalizeStatusEl.textContent = '';
      finalizeStatusEl.className = 'generate__finalize-status';

      // Open in Drive
      const openBtn = document.createElement('a');
      openBtn.href = result.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.className = 'btn btn-primary';
      openBtn.textContent = 'Open final DOCX';
      openBtn.style.marginRight = '8px';
      finalizeStatusEl.appendChild(openBtn);

      // Direct download — uses Drive's `uc?export=download&id=X` endpoint
      // which pushes the file to the browser's download manager.
      const fileId = result.fileId ?? extractFileIdFromUrl(result.url);
      if (fileId) {
        const dlBtn = document.createElement('a');
        dlBtn.href = `https://drive.google.com/uc?export=download&id=${fileId}`;
        dlBtn.target = '_blank';
        dlBtn.rel = 'noopener noreferrer';
        dlBtn.download = result.fileName;
        dlBtn.className = 'btn btn-secondary';
        dlBtn.textContent = 'Download';
        finalizeStatusEl.appendChild(dlBtn);
      }
    } else {
      finalizeStatusEl.textContent = `Template fill failed: ${result.message}`;
      finalizeStatusEl.className = 'generate__finalize-status generate__finalize-status--error';
    }

    updateFinalizeButtons();
  }
  templateBtn.addEventListener('click', () => void handleTemplateClick());

  // ─── Generate click handler ─────────────────────────────────
  generateBtn.addEventListener('click', async () => {
    // Clear any previous resume preview + finalize results before starting
    resumeSlot.replaceChildren();
    finalizeStatusEl.textContent = '';
    finalizeStatusEl.className = 'generate__finalize-status';
    state.docId = null;
    state.jobFolderId = null;

    const cfg = await loadConfigFromStorage();
    const req: Omit<GenerateRequest, 'action'> = {
      jd: state.jd,
      company: state.company,
      role: state.role,
      url: state.url,
      jobInsights: state.scraperOutput?.jobInsights ?? null,
      toggles: state.toggles,
      sourceFolderId: cfg.sourceFolderId,
      rulesFolderId: cfg.rulesFolderId,
      outputFolderId: cfg.outputFolderId,
      sheetId: cfg.sheetId,
      model: state.generateModel,
    };
    await hooks.onGenerate(req);
  });

  // ─── Controller methods ─────────────────────────────────────
  function applyScraperOutput(output: ScraperOutput): void {
    state.scraperOutput = output;
    state.url = output.url;
    state.company = output.company;
    state.role = output.role;
    state.jd = output.jd;

    insightsContainer.replaceChildren(renderJobInsightsCard(output.jobInsights));

    // Update text fields
    const inputs = meta.querySelectorAll<HTMLInputElement>('input');
    if (inputs[0]) inputs[0].value = output.company ?? '';
    if (inputs[1]) inputs[1].value = output.role ?? '';
    if (inputs[2]) inputs[2].value = output.url;
    jdTextarea.value = output.jd;
    jdTokensSpan.textContent = formatTokens(approxTokens(output.jd));
  }

  function showResume(md: string): void {
    const editor = renderResumeEditor({
      initialMarkdown: md,
      onSave: (latest) => hooks.onSaveResume(latest),
    });
    // Wire up the markdown getter so finalize reads the current textarea value.
    const textarea = editor.querySelector<HTMLTextAreaElement>('.resume-editor__textarea');
    currentMarkdownGetter = textarea ? () => textarea.value : () => md;
    resumeSlot.replaceChildren(editor);
    // Auto-scroll the panel to the new preview so the user sees it landed.
    requestAnimationFrame(() => {
      resumeSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * Show the resume editor AND unlock the finalize section with the doc/folder
   * IDs derived from the generate result URLs.
   */
  function showGenerateResult(md: string, docUrl: string, jobFolderUrl: string): void {
    showResume(md);

    const docId = extractDocId(docUrl);
    const jobFolderId = extractFolderId(jobFolderUrl);

    if (!docId || !jobFolderId) {
      console.warn(
        '[JobHelp] Could not extract IDs for finalize. docUrl=%s jobFolderUrl=%s',
        docUrl,
        jobFolderUrl,
      );
    }

    state.docId = docId;
    state.jobFolderId = jobFolderId;

    // Clear any previous finalize results and show the section
    finalizeStatusEl.textContent = '';
    finalizeStatusEl.className = 'generate__finalize-status';
    finalizeSection.hidden = false;
    updateFinalizeButtons();
  }

  function setBusy(busy: boolean, label?: string): void {
    generateBtn.disabled = busy;
    statusEl.textContent = busy ? label ?? 'Working...' : '';
  }

  // Restore last-used model from storage (best-effort; failures ignored).
  void (async () => {
    try {
      const m = await get('defaultGenerateModel');
      if (m) {
        state.generateModel = m;
        renderCostBlock();
      }
      const last = await get('lastToggles');
      if (last) {
        state.toggles = last;
        renderCostBlock();
      }
    } catch {
      // Storage not available — ignore.
    }
  })();

  return { root, applyScraperOutput, showResume, showGenerateResult, setBusy };
}

interface PartialConfig {
  sourceFolderId: string;
  rulesFolderId: string;
  outputFolderId: string;
  sheetId: string;
}

async function loadConfigFromStorage(): Promise<PartialConfig> {
  try {
    const [src, rules, out, sheet] = await Promise.all([
      get('driveSourceFolderId'),
      get('driveRulesFolderId'),
      get('driveOutputFolderId'),
      get('sheetId'),
    ]);
    return {
      sourceFolderId: src ?? '',
      rulesFolderId: rules ?? '',
      outputFolderId: out ?? '',
      sheetId: sheet ?? '',
    };
  } catch {
    return { sourceFolderId: '', rulesFolderId: '', outputFolderId: '', sheetId: '' };
  }
}

/** Tiny helper for the meta-input rows. */
function makeFieldRow(
  label: string,
  type: string,
  initial: string,
  onChange: (val: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.className = 'field-row__label';
  const input = document.createElement('input');
  input.type = type;
  input.className = 'field-row__input';
  input.value = initial;
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(lbl);
  row.appendChild(input);
  // Save typed value into storage on URL change so re-opens remember it
  // (skipped for company/role/JD, which come from the scraper anyway).
  if (label === 'URL') {
    input.addEventListener('change', () => {
      // ignore: persisted via state on Generate
    });
  }
  // Persist URL etc. via no-op for now; presetManager covers richer state.
  void set;
  return row;
}
