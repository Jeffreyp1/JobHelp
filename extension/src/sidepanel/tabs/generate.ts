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
import {
  renderResumeEditor,
  type ResumeReviseEventDetail,
  type ResumeSaveResult,
} from '../components/resumeEditor.js';
import { estimateCost } from '../../lib/costCalculator.js';
import { formatTokens } from '../../lib/tokenFormatter.js';
import { get, set } from '../../lib/storage.js';
import type { ScraperOutput } from '../../types/scraper-output.js';
import type {
  ToggleConfig,
  GenerateRequest,
  FinalizeFormat,
  ResearchCompanyRequest,
  ResearchCompanyResponse,
  BenchmarkRoleRequest,
  BenchmarkRoleResponse,
  CritiqueRequest,
  CritiqueResponse,
  AutoReviseRequest,
  AutoReviseResponse,
  CoverLetterRequest,
  CoverLetterResponse,
  CoverLetterTone,
  VerifyClHooksRequest,
  VerifyClHooksResponse,
  MultiVersionRequest,
  MultiVersionResponse,
  ReviseTargetScope,
} from '../../types/api-contract.js';
import { renderCritiqueResult } from '../features/critique.js';
import { runScopedRevise } from '../features/autoRevise.js';
import { renderReviseComposer } from '../components/reviseComposer.js';
import { setEditorMarkdown } from '../components/resumeEditor.js';
import type {
  AutoReviseScopedRequest,
  AutoReviseScopedResponse,
} from '../../types/api-contract.js';
import { getRuntimeConfig } from '../index.js';
import { log } from '../../lib/structuredLog.js';

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
  showGenerateResult(
    md: string,
    docUrl: string,
    jobFolderUrl: string,
    sheetRowUrl?: string,
    mdFileUrl?: string,
  ): void;
  /** Drive file id of the tailored-resume markdown, or null if unknown. */
  getResumeFileId(): string | null;
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
  onSaveResume: (md: string) => ResumeSaveResult | void | Promise<ResumeSaveResult | void>;
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

  // ─── v2 feature hooks (all optional — graceful degradation if unwired) ────
  onResearchCompany?: (req: Omit<ResearchCompanyRequest, 'action'>) => Promise<ResearchCompanyResponse>;
  onBenchmarkRole?: (req: Omit<BenchmarkRoleRequest, 'action'>) => Promise<BenchmarkRoleResponse>;
  onCritique?: (req: Omit<CritiqueRequest, 'action'>) => Promise<CritiqueResponse>;
  onAutoRevise?: (req: Omit<AutoReviseRequest, 'action'>) => Promise<AutoReviseResponse>;
  onAutoReviseScoped?: (req: AutoReviseScopedRequest) => Promise<AutoReviseScopedResponse>;
  onCoverLetter?: (req: Omit<CoverLetterRequest, 'action'>) => Promise<CoverLetterResponse>;
  onVerifyClHooks?: (req: Omit<VerifyClHooksRequest, 'action'>) => Promise<VerifyClHooksResponse>;
  onMultiVersion?: (req: Omit<MultiVersionRequest, 'action'>) => Promise<MultiVersionResponse>;
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
    // Drive file id of the tailored-resume markdown; used by Save & Log.
    mdFileId: null as string | null,
    // Tracking-sheet row URL from the generate result — passed into the v2
    // post-gen calls (critique / cover letter / verify hooks) so they can
    // update the sheet's result columns.
    sheetRowUrl: null as string | null,

    // ─── v2 feature toggle state ─────────────────────────────────────────
    researchEnabled: false,
    researchModel: HAIKU,
    benchmarkEnabled: false,
    benchmarkModel: HAIKU,
    critiqueEnabled: false,
    critiqueModel: HAIKU,
    autoReviseEnabled: false,
    autoReviseModel: HAIKU,
    coverLetterEnabled: false,
    coverLetterModel: HAIKU,
    coverLetterTone: 'neutral' as 'neutral' | 'formal' | 'casual' | 'technical' | 'persuasive',
    verifyHooksModel: HAIKU,
    multiVersionEnabled: false,
    multiVersionModel: SONNET,
    multiVersionCount: 3,

    // Latest cover-letter markdown (used by verify-hooks).
    coverLetterMd: null as string | null,
  };

  // Reference to the resume editor's textarea so finalize can read the
  // current (potentially user-edited) markdown.
  let currentMarkdownGetter: (() => string) | null = null;
  let editorEl: HTMLElement | null = null;

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

  // ─── Live v2 toggles ─────────────────────────────────────────────────
  // Research
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Research company',
      enabled: state.researchEnabled,
      featureKey: 'research',
      models: ALL_MODELS,
      selectedModel: state.researchModel,
      onToggle: (v) => { state.researchEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.researchModel = m; void persistTogglesState(); renderCostBlock(); },
    }),
  );

  // LinkedIn benchmarking
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'LinkedIn role benchmark',
      enabled: state.benchmarkEnabled,
      featureKey: 'benchmark',
      models: ALL_MODELS,
      selectedModel: state.benchmarkModel,
      onToggle: (v) => { state.benchmarkEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.benchmarkModel = m; void persistTogglesState(); renderCostBlock(); },
    }),
  );

  // Critique pass
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Critique pass',
      enabled: state.critiqueEnabled,
      featureKey: 'critique',
      models: ALL_MODELS,
      selectedModel: state.critiqueModel,
      onToggle: (v) => { state.critiqueEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.critiqueModel = m; void persistTogglesState(); renderCostBlock(); },
    }),
  );
  const critiqueResultSlot = document.createElement('div');
  critiqueResultSlot.setAttribute('data-critique-result', '');
  critiqueResultSlot.className = 'feature-result feature-result--critique';
  togglesBlock.appendChild(critiqueResultSlot);

  // Auto-revise (whole-resume only for v2 wiring)
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Auto-revise (whole resume)',
      enabled: state.autoReviseEnabled,
      featureKey: 'autoRevise',
      models: ALL_MODELS,
      selectedModel: state.autoReviseModel,
      onToggle: (v) => { state.autoReviseEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.autoReviseModel = m; void persistTogglesState(); renderCostBlock(); },
    }),
  );
  // Multi-version (count + model)
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Multi-version',
      enabled: state.multiVersionEnabled,
      featureKey: 'multiVersion',
      models: ALL_MODELS,
      selectedModel: state.multiVersionModel,
      counts: [2, 3, 4, 5],
      selectedCount: state.multiVersionCount,
      onToggle: (v) => { state.multiVersionEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.multiVersionModel = m; void persistTogglesState(); renderCostBlock(); },
      onCountChange: (n) => { state.multiVersionCount = n; void persistTogglesState(); renderCostBlock(); },
    }),
  );

  // Cover letter
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Cover letter',
      enabled: state.coverLetterEnabled,
      featureKey: 'coverLetter',
      models: ALL_MODELS,
      selectedModel: state.coverLetterModel,
      tones: ['neutral', 'formal', 'casual', 'technical', 'persuasive'],
      selectedTone: state.coverLetterTone,
      onToggle: (v) => { state.coverLetterEnabled = v; void persistTogglesState(); renderCostBlock(); },
      onModelChange: (m) => { state.coverLetterModel = m; void persistTogglesState(); renderCostBlock(); },
      onToneChange: (t) => {
        state.coverLetterTone = t as typeof state.coverLetterTone;
        void persistTogglesState();
        renderCostBlock();
      },
    }),
  );
  const clResultSlot = document.createElement('div');
  clResultSlot.setAttribute('data-role', 'cl-result');
  clResultSlot.className = 'feature-result feature-result--cl';
  togglesBlock.appendChild(clResultSlot);

  // Verify CL hooks (model-only, no toggle — triggered from CL result button)
  togglesBlock.appendChild(
    renderToggleRow({
      label: 'Verify CL hooks (model only)',
      enabled: true,
      featureKey: 'verifyHooks',
      models: ALL_MODELS,
      selectedModel: state.verifyHooksModel,
      onModelChange: (m) => { state.verifyHooksModel = m; void persistTogglesState(); renderCostBlock(); },
    }),
  );
  const verifyResultSlot = document.createElement('div');
  verifyResultSlot.setAttribute('data-role', 'verify-result');
  verifyResultSlot.className = 'feature-result feature-result--verify';
  togglesBlock.appendChild(verifyResultSlot);

  root.appendChild(togglesBlock);

  /** Persist current toggle/model selections to chrome.storage. */
  async function persistTogglesState(): Promise<void> {
    try {
      await set('v2Toggles', {
        researchEnabled: state.researchEnabled,
        researchModel: state.researchModel,
        benchmarkEnabled: state.benchmarkEnabled,
        benchmarkModel: state.benchmarkModel,
        critiqueEnabled: state.critiqueEnabled,
        critiqueModel: state.critiqueModel,
        autoReviseEnabled: state.autoReviseEnabled,
        autoReviseModel: state.autoReviseModel,
        coverLetterEnabled: state.coverLetterEnabled,
        coverLetterModel: state.coverLetterModel,
        coverLetterTone: state.coverLetterTone,
        verifyHooksModel: state.verifyHooksModel,
        multiVersionEnabled: state.multiVersionEnabled,
        multiVersionModel: state.multiVersionModel,
        multiVersionCount: state.multiVersionCount,
      });
    } catch {
      // storage unavailable — ignore
    }
  }

  // ─── 5. Cost estimator (re-renderable) ──────────────────────────
  const costContainer = document.createElement('div');
  costContainer.className = 'generate__cost';
  function renderCostBlock() {
    costContainer.replaceChildren(
      renderCostEstimator(
        estimateCost(state.toggles, state.generateModel, {
          researchEnabled: state.researchEnabled,
          researchModel: state.researchModel,
          benchmarkEnabled: state.benchmarkEnabled,
          benchmarkModel: state.benchmarkModel,
          critiqueEnabled: state.critiqueEnabled,
          critiqueModel: state.critiqueModel,
          autoReviseEnabled: state.autoReviseEnabled,
          autoReviseModel: state.autoReviseModel,
          coverLetterEnabled: state.coverLetterEnabled,
          coverLetterModel: state.coverLetterModel,
          verifyHooksEnabled: state.coverLetterEnabled,
          verifyHooksModel: state.verifyHooksModel,
          multiVersionEnabled: state.multiVersionEnabled,
          multiVersionModel: state.multiVersionModel,
          multiVersionCount: state.multiVersionCount,
        }),
      ),
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
    // Clear all preview/result slots before starting.
    resumeSlot.replaceChildren();
    critiqueResultSlot.replaceChildren();
    clResultSlot.replaceChildren();
    verifyResultSlot.replaceChildren();
    finalizeStatusEl.textContent = '';
    finalizeStatusEl.className = 'generate__finalize-status';
    state.docId = null;
    state.jobFolderId = null;
    state.sheetRowUrl = null;
    state.coverLetterMd = null;

    const cfg = getRuntimeConfig();
    if (!cfg) {
      setBusy(false);
      statusEl.textContent = 'JobHelp config not loaded. Run setup in Settings first.';
      return;
    }

    // ── Multi-version branch (mutually exclusive with standard generate) ──
    if (state.multiVersionEnabled) {
      if (!hooks.onMultiVersion) {
        console.warn('[generate] multi-version enabled but onMultiVersion hook missing');
        return;
      }
      setBusy(true, `Generating ${state.multiVersionCount} variants…`);
      try {
        const result = await hooks.onMultiVersion({
          jd: state.jd,
          company: state.company,
          role: state.role,
          jobInsights: state.scraperOutput?.jobInsights ?? null,
          sourceFolderId: cfg.folders.source,
          rulesFolderId: cfg.folders.rules,
          count: state.multiVersionCount,
          model: state.multiVersionModel,
        });
        renderMultiVersionResult(result);
      } catch (e) {
        console.error('[generate] multi-version failed', e);
        statusEl.textContent = `Multi-version failed: ${(e as Error).message}`;
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── Standard flow: optional research+benchmark pre-fetch, then generate ──
    let researchSummary: string | undefined;
    let benchmarkPatterns: string | undefined;

    if (state.researchEnabled && state.company && hooks.onResearchCompany) {
      setBusy(true, 'Researching company…');
      try {
        const r = await hooks.onResearchCompany({
          company: state.company,
          role: state.role,
          model: state.researchModel,
        });
        if (r.ok) {
          researchSummary = r.summary;
        } else {
          console.warn('[generate] research failed:', r.error.message);
        }
      } catch (e) {
        console.error('[generate] research threw:', e);
      }
    }

    if (state.benchmarkEnabled && state.company && state.role && hooks.onBenchmarkRole) {
      setBusy(true, 'Benchmarking role…');
      try {
        const b = await hooks.onBenchmarkRole({
          company: state.company,
          role: state.role,
          model: state.benchmarkModel,
        });
        if (b.ok) {
          benchmarkPatterns = b.patterns;
        } else {
          console.warn('[generate] benchmark failed:', b.error.message);
        }
      } catch (e) {
        console.error('[generate] benchmark threw:', e);
      }
    }

    const req: Omit<GenerateRequest, 'action'> = {
      jd: state.jd,
      company: state.company,
      role: state.role,
      url: state.url,
      jobInsights: state.scraperOutput?.jobInsights ?? null,
      toggles: state.toggles,
      sourceFolderId: cfg.folders.source,
      rulesFolderId: cfg.folders.rules,
      outputFolderId: cfg.folders.output,
      sheetId: cfg.sheetId,
      model: state.generateModel,
      researchSummary,
      benchmarkPatterns,
    };
    // Reset busy before delegating to onGenerate. In production the hook
    // immediately calls setBusy(true, 'Generating…'), so UX is continuous;
    // here it lets subsequent clicks proceed when the hook is fire-and-forget.
    setBusy(false);
    try {
      await hooks.onGenerate(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[generate] onGenerate threw:', e);
      // setBusy(false) clears the status text, so set the error AFTER it.
      setBusy(false);
      statusEl.textContent = `Generate failed: ${msg}`;
    }
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
    editorEl = editor;
    const rawTa = editor.querySelector<HTMLTextAreaElement>('.resume-editor__raw-textarea');
    currentMarkdownGetter = rawTa ? () => rawTa.value : () => md;
    resumeSlot.replaceChildren(editor);
    editor.addEventListener('resume:revise', (ev) => {
      const detail = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
      const target = ev.target instanceof HTMLElement ? ev.target : editor;
      // whole-resume has no per-element anchor; the composer renders below the editor wrapper
      const anchorEl =
        detail.scope.kind === 'bullet'
          ? target.closest<HTMLElement>('[data-bullet-id]') ?? target
          : detail.scope.kind === 'section'
          ? target.closest<HTMLElement>('[data-section-name]') ?? target
          : target;
      void runAutoReviseScoped(detail.scope, anchorEl);
    });
    // Auto-scroll the panel to the new preview so the user sees it landed.
    requestAnimationFrame(() => {
      if (typeof resumeSlot.scrollIntoView === 'function') {
        resumeSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  /**
   * Show the resume editor AND unlock the finalize section with the doc/folder
   * IDs derived from the generate result URLs.
   */
  function showGenerateResult(
    md: string,
    docUrl: string,
    jobFolderUrl: string,
    sheetRowUrl?: string,
    mdFileUrl?: string,
  ): void {
    // Set before showResume so the editor's Save & Log callback can read it.
    state.mdFileId = mdFileUrl ? extractFileIdFromUrl(mdFileUrl) : null;
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
    // Capture the tracking-sheet row URL alongside jobFolderId so the v2
    // post-gen calls can write their result columns to that row.
    state.sheetRowUrl = sheetRowUrl && sheetRowUrl.length > 0 ? sheetRowUrl : null;

    // Clear any previous finalize results and show the section
    finalizeStatusEl.textContent = '';
    finalizeStatusEl.className = 'generate__finalize-status';
    finalizeSection.hidden = false;
    updateFinalizeButtons();

    // ── Post-gen feature chain: critique + cover letter run in parallel ──
    void runPostGenerateChain(md, jobFolderId);
  }

  /**
   * Build the optional `{ sheetId, rowUrl }` pair that the v2 handlers use to
   * update the tracking sheet. Returns an empty object when either piece is
   * missing — the backend only writes when BOTH are present.
   */
  function sheetRowParams(): { sheetId?: string; rowUrl?: string } {
    const sheetId = getRuntimeConfig()?.sheetId;
    const rowUrl = state.sheetRowUrl;
    if (!sheetId || !rowUrl) return {};
    return { sheetId, rowUrl };
  }

  /** Run critique + cover-letter in parallel after generate succeeds. */
  async function runPostGenerateChain(resumeMd: string, jobFolderId: string | null): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (state.critiqueEnabled && hooks.onCritique && jobFolderId) {
      tasks.push(runCritique(resumeMd, jobFolderId));
    }
    if (state.coverLetterEnabled && hooks.onCoverLetter && jobFolderId) {
      tasks.push(runCoverLetter(resumeMd, jobFolderId));
    }

    await Promise.allSettled(tasks);
  }

  async function runCritique(resumeMd: string, jobFolderId: string): Promise<void> {
    if (!hooks.onCritique) return;
    critiqueResultSlot.textContent = 'Running critique…';
    try {
      const result = await hooks.onCritique({
        resumeMd,
        jd: state.jd,
        jobInsights: state.scraperOutput?.jobInsights ?? null,
        jobFolderId,
        model: state.critiqueModel,
        ...sheetRowParams(),
      });
      renderCritiqueResult(root, result);
    } catch (e) {
      console.error('[generate] critique threw:', e);
      critiqueResultSlot.textContent = `Critique failed: ${(e as Error).message}`;
    }
  }

  async function runCoverLetter(resumeMd: string, jobFolderId: string): Promise<void> {
    if (!hooks.onCoverLetter) return;
    const cfg = getRuntimeConfig();
    if (!cfg) {
      clResultSlot.textContent = 'JobHelp config not loaded. Run setup in Settings first.';
      return;
    }
    clResultSlot.textContent = 'Generating cover letter…';
    try {
      const result = await hooks.onCoverLetter({
        resumeMd,
        jd: state.jd,
        company: state.company,
        role: state.role,
        sourceFolderId: cfg.folders.source,
        rulesFolderId: cfg.folders.rules,
        jobFolderId,
        model: state.coverLetterModel,
        // Omit "neutral" so the backend default applies (backwards-compat).
        tone:
          state.coverLetterTone === 'neutral'
            ? undefined
            : (state.coverLetterTone as CoverLetterTone),
        ...sheetRowParams(),
      });
      renderCoverLetterResult(result);
    } catch (e) {
      console.error('[generate] cover letter threw:', e);
      clResultSlot.textContent = `Cover letter failed: ${(e as Error).message}`;
    }
  }

  function renderCoverLetterResult(result: CoverLetterResponse): void {
    clResultSlot.replaceChildren();
    if (!result.ok) {
      clResultSlot.textContent = `Cover letter failed: ${result.error.message}`;
      return;
    }
    state.coverLetterMd = result.coverLetterMd;

    const wc = result.coverLetterMd.trim().split(/\s+/).length;
    const links: string[] = [];
    if (result.mdFileUrl) links.push(`<a href="${escapeAttr(result.mdFileUrl)}" target="_blank" rel="noopener">cover_letter.md ↗</a>`);
    if (result.docUrl) links.push(`<a href="${escapeAttr(result.docUrl)}" target="_blank" rel="noopener">Google Doc ↗</a>`);

    clResultSlot.innerHTML = `
      <div class="cl-success">
        <div class="cl-links">${links.join(' · ')}</div>
        <div class="cl-meta">${wc} words (target 250-300)</div>
        <button type="button" class="btn btn-secondary" data-action="verify-hooks">Verify Hooks</button>
      </div>
    `;

    const verifyBtn = clResultSlot.querySelector<HTMLButtonElement>('[data-action="verify-hooks"]');
    verifyBtn?.addEventListener('click', () => {
      void runVerifyHooks(result.coverLetterMd);
    });
  }

  async function runVerifyHooks(coverLetterMd: string): Promise<void> {
    if (!hooks.onVerifyClHooks) {
      verifyResultSlot.textContent = 'Verify-hooks hook not wired.';
      return;
    }
    verifyResultSlot.textContent = 'Verifying named entities…';
    try {
      const result = await hooks.onVerifyClHooks({
        coverLetterMd,
        model: state.verifyHooksModel,
        ...sheetRowParams(),
      });
      renderVerifyHooksResult(result);
    } catch (e) {
      console.error('[generate] verify-hooks threw:', e);
      verifyResultSlot.textContent = `Verify-hooks failed: ${(e as Error).message}`;
    }
  }

  function renderVerifyHooksResult(result: VerifyClHooksResponse): void {
    verifyResultSlot.replaceChildren();
    if (!result.ok) {
      verifyResultSlot.textContent = `Verify-hooks failed: ${result.error.message}`;
      return;
    }
    const icon: Record<string, string> = { verified: '✓', unverified: '⚠', uncertain: '?' };
    const items = result.verifications.map(v => `
      <li class="verify-item verify-item--${v.status}">
        <span class="verify-icon">${icon[v.status] ?? '?'}</span>
        <strong>${escapeHtml(v.entity)}</strong> <small>(${escapeHtml(v.entityType)})</small>
        ${v.reason ? `<div class="verify-reason">${escapeHtml(v.reason)}</div>` : ''}
      </li>
    `).join('');
    const banner = result.unverifiedCount > 0
      ? `<div class="verify-banner verify-banner--warn">⚠ ${result.unverifiedCount} unverified entit${result.unverifiedCount === 1 ? 'y' : 'ies'}</div>`
      : '<div class="verify-banner verify-banner--ok">All entities verified</div>';
    verifyResultSlot.innerHTML = `
      ${banner}
      <ul class="verify-list">${items}</ul>
      <div class="verify-cost">Cost: $${result.cost.totalUsd.toFixed(4)}</div>
    `;
  }

  async function runAutoReviseScoped(
    scope: ReviseTargetScope,
    anchorEl: HTMLElement,
  ): Promise<void> {
    const md = currentMarkdownGetter ? currentMarkdownGetter() : '';

    if (scope.kind === 'whole-resume') {
      await runWholeResumeRevise(md, anchorEl);
      return;
    }
    if (scope.kind !== 'bullet' && scope.kind !== 'section') return;
    const scopeKind: 'bullet' | 'section' = scope.kind;

    const scopedHook = hooks.onAutoReviseScoped;
    if (!scopedHook) return;

    const composerHost = document.createElement('div');
    composerHost.className = 'revise-composer-host';
    const existing = anchorEl.nextElementSibling;
    if (existing?.classList.contains('revise-composer-host')) existing.remove();
    anchorEl.insertAdjacentElement('afterend', composerHost);

    const closeComposer = (): void => composerHost.remove();

    const composer = renderReviseComposer({
      scope: scopeKind,
      onCancel: closeComposer,
      onSubmit: (instruction) => {
        composerHost.replaceChildren();
        void runScopedRevise({
          api: { autoReviseScoped: scopedHook },
          slot: composerHost,
          scope: scopeKind,
          currentMarkdown: md,
          bulletText: scope.kind === 'bullet' ? extractBulletText(anchorEl) : undefined,
          sectionPath:
            scope.kind === 'section'
              ? scope.sectionName
              : extractSectionForBullet(anchorEl),
          instruction,
          model: state.autoReviseModel,
          useChecker: true,
          onAccept: (nextMd) => {
            if (editorEl) setEditorMarkdown(editorEl, nextMd);
            closeComposer();
          },
          onReject: closeComposer,
        });
      },
    });
    composerHost.appendChild(composer);
  }

  async function runWholeResumeRevise(md: string, anchorEl: HTMLElement): Promise<void> {
    const wholeHook = hooks.onAutoRevise;
    if (!wholeHook) return;

    const composerHost = document.createElement('div');
    composerHost.className = 'revise-composer-host';
    const existing = anchorEl.nextElementSibling;
    if (existing?.classList.contains('revise-composer-host')) existing.remove();
    anchorEl.insertAdjacentElement('afterend', composerHost);

    const closeComposer = (): void => composerHost.remove();

    const composer = renderReviseComposer({
      scope: 'whole-resume',
      onCancel: closeComposer,
      onSubmit: async (instruction) => {
        composerHost.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'revise-loading';
        loading.textContent = 'Revising whole resume…';
        composerHost.appendChild(loading);
        try {
          const resp = await wholeHook({
            currentMarkdown: md,
            targetScope: { kind: 'whole-resume' },
            instruction,
            model: state.autoReviseModel,
          });
          if (!composerHost.isConnected) {
            log('debug', 'whole-resume revise discarded: composer closed', { scope: 'whole-resume' });
            return;
          }
          if (!resp.ok) {
            const err = document.createElement('div');
            err.className = 'revise-error';
            err.textContent = `Revise failed: ${resp.error.message}`;
            composerHost.replaceChildren(err);
            return;
          }
          if (editorEl) setEditorMarkdown(editorEl, resp.revisedMarkdown);
          closeComposer();
        } catch (e) {
          if (!composerHost.isConnected) {
            log('debug', 'whole-resume revise discarded: composer closed', { scope: 'whole-resume' });
            return;
          }
          const err = document.createElement('div');
          err.className = 'revise-error';
          err.textContent = `Revise failed: ${e instanceof Error ? e.message : String(e)}`;
          composerHost.replaceChildren(err);
        }
      },
    });
    composerHost.appendChild(composer);
  }

  function extractBulletText(bulletEl: HTMLElement): string {
    const span = bulletEl.querySelector('.resume-bullet__text');
    return span?.textContent?.trim() ?? '';
  }

  function extractSectionForBullet(bulletEl: HTMLElement): string {
    const section = bulletEl.closest<HTMLElement>('[data-section-name]');
    return section?.dataset.sectionName ?? '';
  }

  function renderMultiVersionResult(result: MultiVersionResponse): void {
    resumeSlot.replaceChildren();
    if (!result.ok) {
      resumeSlot.textContent = `Multi-version failed: ${result.error.message}`;
      return;
    }
    const variants = result.variants;
    const totalUsd = result.cost.totalUsd;

    const container = document.createElement('div');
    container.className = 'mv-result';

    const tabs = document.createElement('div');
    tabs.className = 'mv-tabs';
    const preview = document.createElement('pre');
    preview.className = 'mv-preview';

    let selectedIndex = 0;

    function activate(i: number): void {
      selectedIndex = i;
      const v = variants[i];
      if (!v) return;
      preview.textContent = v.markdown;
      tabs.querySelectorAll('button').forEach((b, j) => {
        b.classList.toggle('mv-tab-active', j === i);
      });
    }

    variants.forEach((v, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mv-tab btn';
      btn.textContent = v.label;
      btn.addEventListener('click', () => activate(i));
      tabs.appendChild(btn);
    });

    const cost = document.createElement('p');
    cost.className = 'mv-cost';
    cost.textContent = `Total cost: $${totalUsd.toFixed(4)} (${variants.length} variants)`;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary mv-save';
    saveBtn.textContent = 'Save this version';
    saveBtn.addEventListener('click', () => {
      const v = variants[selectedIndex];
      if (!v) return;
      // Display as the canonical resume so user can finalize / convert.
      showResume(v.markdown);
    });

    container.appendChild(tabs);
    container.appendChild(preview);
    container.appendChild(cost);
    container.appendChild(saveBtn);
    resumeSlot.appendChild(container);

    activate(0);

    requestAnimationFrame(() => {
      if (typeof resumeSlot.scrollIntoView === 'function') {
        resumeSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function setBusy(busy: boolean, label?: string): void {
    generateBtn.disabled = busy;
    statusEl.textContent = busy ? label ?? 'Working...' : '';
  }

  // Restore last-used model + toggles (best-effort; failures ignored).
  //
  // The default generate model comes from the Drive-hosted jobhelp-config.json
  // (`defaults.model`) — read via getRuntimeConfig() rather than the legacy
  // `defaultGenerateModel` storage key. If the config hasn't finished loading
  // yet, the model select stays on its built-in default (HAIKU).
  void (async () => {
    try {
      const m = getRuntimeConfig()?.defaults.model;
      if (m && ALL_MODELS.includes(m)) {
        state.generateModel = m;
        renderCostBlock();
      }
      const last = await get('lastToggles');
      if (last) {
        state.toggles = last;
        renderCostBlock();
      }
      // Restore v2 toggle state. Re-render the toggles block so the saved
      // selections are reflected in the DOM (otherwise the user sees defaults).
      const v2 = await get('v2Toggles');
      if (v2) {
        // Validate model strings against ALL_MODELS — a previous version
        // could have saved a model id that's no longer recognized. Falling
        // back to HAIKU (default) instead of restoring an invalid string
        // that would silently break the DOM select + cost preview.
        const safeModel = (m: string): string => {
          if (ALL_MODELS.includes(m)) return m;
          console.warn(`[generate] unknown restored model "${m}", falling back to ${HAIKU}`);
          return HAIKU;
        };
        state.researchEnabled = v2.researchEnabled;
        state.researchModel = safeModel(v2.researchModel);
        state.benchmarkEnabled = v2.benchmarkEnabled;
        state.benchmarkModel = safeModel(v2.benchmarkModel);
        state.critiqueEnabled = v2.critiqueEnabled;
        state.critiqueModel = safeModel(v2.critiqueModel);
        state.autoReviseEnabled = v2.autoReviseEnabled;
        state.autoReviseModel = safeModel(v2.autoReviseModel);
        state.coverLetterEnabled = v2.coverLetterEnabled;
        state.coverLetterModel = safeModel(v2.coverLetterModel);
        if (v2.coverLetterTone) {
          state.coverLetterTone = v2.coverLetterTone as typeof state.coverLetterTone;
        }
        state.verifyHooksModel = safeModel(v2.verifyHooksModel);
        state.multiVersionEnabled = v2.multiVersionEnabled;
        state.multiVersionModel = safeModel(v2.multiVersionModel);
        state.multiVersionCount = v2.multiVersionCount;

        // Reflect restored state into the live DOM (checkboxes + selects).
        togglesBlock.querySelectorAll<HTMLElement>('[data-feature]').forEach((row) => {
          const key = row.getAttribute('data-feature');
          const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          const modelSel = row.querySelector<HTMLSelectElement>('select.model-select');
          const countSel = row.querySelector<HTMLSelectElement>('select.count-select');
          switch (key) {
            case 'research':
              if (cb) cb.checked = state.researchEnabled;
              if (modelSel) modelSel.value = state.researchModel;
              break;
            case 'benchmark':
              if (cb) cb.checked = state.benchmarkEnabled;
              if (modelSel) modelSel.value = state.benchmarkModel;
              break;
            case 'critique':
              if (cb) cb.checked = state.critiqueEnabled;
              if (modelSel) modelSel.value = state.critiqueModel;
              break;
            case 'autoRevise':
              if (cb) cb.checked = state.autoReviseEnabled;
              if (modelSel) modelSel.value = state.autoReviseModel;
              break;
            case 'multiVersion':
              if (cb) cb.checked = state.multiVersionEnabled;
              if (modelSel) modelSel.value = state.multiVersionModel;
              if (countSel) countSel.value = String(state.multiVersionCount);
              break;
            case 'coverLetter': {
              if (cb) cb.checked = state.coverLetterEnabled;
              if (modelSel) modelSel.value = state.coverLetterModel;
              const toneSel = row.querySelector<HTMLSelectElement>('select.tone-select');
              if (toneSel) toneSel.value = state.coverLetterTone;
              break;
            }
            case 'verifyHooks':
              if (modelSel) modelSel.value = state.verifyHooksModel;
              break;
          }
        });
      }
    } catch {
      // Storage not available — ignore.
    }
  })();

  function getResumeFileId(): string | null {
    return state.mdFileId;
  }

  return { root, applyScraperOutput, showResume, showGenerateResult, getResumeFileId, setBusy };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
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
