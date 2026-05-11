/** @vitest-environment jsdom */
/**
 * Integration tests for the v2-wired Generate tab orchestration.
 *
 * Covers the seven v2 hooks (research, benchmark, critique, auto-revise,
 * cover letter, verify-hooks, multi-version) plus the pre-flight pipeline,
 * the parallel post-generate chain, storage persistence, and graceful
 * degradation when hooks are unwired.
 *
 * Mocking approach: the test installs an in-memory chrome.storage.local
 * mock onto globalThis via `installChromeMock()` (see helpers/chrome-mocks).
 * The real `lib/storage.ts` wrapper is used end-to-end — no module mocks.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderGenerateTab } from '../../src/sidepanel/tabs/generate';
import type { GenerateTabHooks, GenerateTabController } from '../../src/sidepanel/tabs/generate';
import type {
  ResearchCompanyResponse,
  BenchmarkRoleResponse,
  CritiqueResponse,
  AutoReviseResponse,
  CoverLetterResponse,
  VerifyClHooksResponse,
  MultiVersionResponse,
} from '../../src/types/api-contract';
import type { V2TogglesState } from '../../src/types/storage-schema';
import { installChromeMock } from '../helpers/chrome-mocks';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

// ─── fixture builders ───────────────────────────────────────────────

const OK_RESEARCH: ResearchCompanyResponse = {
  ok: true,
  summary: 'Acme is a SaaS company; recent Series C; key product line: X',
  keywords: ['saas', 'series c'],
  sources: [{ title: 'TechCrunch', url: 'https://example.com/tc' }],
  cached: false,
  cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
};

const OK_BENCHMARK: BenchmarkRoleResponse = {
  ok: true,
  patterns: 'Senior IC pattern: 5+ YOE; distributed systems; mentoring',
  keywords: ['distributed systems', 'mentoring'],
  sources: [{ title: 'LinkedIn', url: 'https://example.com/li' }],
  cached: false,
  cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
};

const OK_CRITIQUE: CritiqueResponse = {
  ok: true,
  scores: [{ dimension: 'keyword-coverage', score: 8, weight: 1, notes: 'good' }],
  totalScore: 8,
  improvements: [{ tier: 1, text: 'Add metrics to bullet 3', expectedDelta: 0.5 }],
  critiqueDocUrl: null,
  cost: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.002 },
};

const OK_COVER_LETTER: CoverLetterResponse = {
  ok: true,
  coverLetterMd: 'Dear hiring manager,\n\nI was thrilled to read about the role...',
  docUrl: 'https://docs.google.com/document/d/clDocId/edit',
  mdFileUrl: 'https://drive.google.com/file/d/clMdFileId/view',
  cost: { inputTokens: 300, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.003 },
};

const OK_VERIFY_HOOKS: VerifyClHooksResponse = {
  ok: true,
  verifications: [
    { entity: 'Dr. Foo', entityType: 'person', status: 'verified', sources: [] },
  ],
  unverifiedCount: 0,
  cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
};

const OK_MULTI_VERSION: MultiVersionResponse = {
  ok: true,
  variants: [
    { label: 'Technical depth', framing: 'tech', markdown: '# Variant 1' },
    { label: 'Leadership', framing: 'lead', markdown: '# Variant 2' },
    { label: 'Business outcomes', framing: 'biz', markdown: '# Variant 3' },
  ],
  cost: { inputTokens: 500, outputTokens: 300, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.005 },
};

const OK_AUTO_REVISE: AutoReviseResponse = {
  ok: true,
  revisedMarkdown: '# Revised resume',
  diff: [{ lineIndex: 0, before: '# Resume', after: '# Revised resume' }],
  unauthorizedChanges: [],
  cost: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.002 },
};

// ─── helpers ────────────────────────────────────────────────────────

/**
 * Build a fresh hooks object with vi.fn() for each method. Caller can
 * override specific hooks (or omit them to test graceful degradation).
 */
function buildHooks(overrides: Partial<GenerateTabHooks> = {}): GenerateTabHooks {
  return {
    onGenerate: vi.fn().mockResolvedValue(undefined),
    onSaveResume: vi.fn().mockResolvedValue(undefined),
    onFinalize: vi.fn().mockResolvedValue({ ok: false, message: 'stub' }),
    ...overrides,
  };
}

/**
 * Mount the tab and wait one microtask tick for the storage-restore IIFE
 * to settle (it's fired in a `void (async () => {...})()` at the end of
 * renderGenerateTab and reads from chrome.storage).
 */
async function mount(hooks: GenerateTabHooks): Promise<GenerateTabController> {
  const ctrl = renderGenerateTab(hooks);
  // Allow the storage-restore IIFE microtasks to settle before tests probe DOM/state.
  await flush();
  return ctrl;
}

/** Run pending promise microtasks. Several flushes cover chained awaits. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // setTimeout 0 yields to the macrotask queue, ensuring chained
    // awaits inside the click handler complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function clickGenerate(ctrl: GenerateTabController): void {
  const btn = ctrl.root.querySelector<HTMLButtonElement>('.generate__btn');
  if (!btn) throw new Error('generate button not found');
  btn.click();
}

function setMetaInputs(
  ctrl: GenerateTabController,
  values: { company?: string; role?: string; url?: string; jd?: string } = {},
): void {
  const inputs = ctrl.root.querySelectorAll<HTMLInputElement>('.generate__meta input');
  // Order: company, role, url
  if (values.company !== undefined && inputs[0]) {
    inputs[0].value = values.company;
    inputs[0].dispatchEvent(new Event('input'));
  }
  if (values.role !== undefined && inputs[1]) {
    inputs[1].value = values.role;
    inputs[1].dispatchEvent(new Event('input'));
  }
  if (values.url !== undefined && inputs[2]) {
    inputs[2].value = values.url;
    inputs[2].dispatchEvent(new Event('input'));
  }
  if (values.jd !== undefined) {
    const ta = ctrl.root.querySelector<HTMLTextAreaElement>('.generate__jd-textarea');
    if (ta) {
      ta.value = values.jd;
      ta.dispatchEvent(new Event('input'));
    }
  }
}

/** Toggle the checkbox on a row identified by data-feature attribute. */
function toggleFeature(ctrl: GenerateTabController, featureKey: string, enabled: boolean): void {
  const row = ctrl.root.querySelector<HTMLElement>(`[data-feature="${featureKey}"]`);
  if (!row) throw new Error(`feature row ${featureKey} not found`);
  const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!cb) throw new Error(`checkbox not found in ${featureKey}`);
  if (cb.checked !== enabled) {
    cb.checked = enabled;
    cb.dispatchEvent(new Event('change'));
  }
}

// ─── tests ──────────────────────────────────────────────────────────

describe('renderGenerateTab — v2 orchestration', () => {
  beforeEach(() => {
    installChromeMock();
    // jsdom does not implement scrollIntoView; generate.ts uses it inside a
    // requestAnimationFrame callback after showResume / multi-version render.
    // Polyfill on Element.prototype so the rAF callback doesn't throw an
    // uncaught exception that pollutes the test output.
    if (!('scrollIntoView' in Element.prototype)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Element.prototype as any).scrollIntoView = function () {};
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a controller exposing the required methods', async () => {
    const ctrl = await mount(buildHooks());
    expect(ctrl.root).toBeInstanceOf(HTMLElement);
    expect(typeof ctrl.applyScraperOutput).toBe('function');
    expect(typeof ctrl.showResume).toBe('function');
    expect(typeof ctrl.showGenerateResult).toBe('function');
    expect(typeof ctrl.setBusy).toBe('function');
    expect(ctrl.root.classList.contains('tab-pane--generate')).toBe(true);
  });

  it('click Generate with all toggles off → only onGenerate is called', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onResearchCompany = vi.fn();
    const onBenchmarkRole = vi.fn();
    const onMultiVersion = vi.fn();
    const ctrl = await mount(
      buildHooks({ onGenerate, onResearchCompany, onBenchmarkRole, onMultiVersion }),
    );
    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD body' });
    clickGenerate(ctrl);
    await flush();

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onResearchCompany).not.toHaveBeenCalled();
    expect(onBenchmarkRole).not.toHaveBeenCalled();
    expect(onMultiVersion).not.toHaveBeenCalled();

    const req = onGenerate.mock.calls[0][0];
    expect(req.company).toBe('Acme');
    expect(req.role).toBe('SWE');
    expect(req.jd).toBe('JD body');
    expect(req.researchSummary).toBeUndefined();
    expect(req.benchmarkPatterns).toBeUndefined();
  });

  it('researchEnabled + company set → onResearchCompany called first; onGenerate gets researchSummary', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onResearchCompany = vi.fn().mockResolvedValue(OK_RESEARCH);
    const ctrl = await mount(buildHooks({ onGenerate, onResearchCompany }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'research', true);

    clickGenerate(ctrl);
    await flush();

    expect(onResearchCompany).toHaveBeenCalledTimes(1);
    expect(onResearchCompany).toHaveBeenCalledWith({
      company: 'Acme',
      role: 'SWE',
      model: HAIKU,
    });

    // Ordering: research resolves before onGenerate is called.
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const researchCallIdx = onResearchCompany.mock.invocationCallOrder[0];
    const generateCallIdx = onGenerate.mock.invocationCallOrder[0];
    expect(researchCallIdx).toBeLessThan(generateCallIdx);

    const req = onGenerate.mock.calls[0][0];
    expect(req.researchSummary).toBe(OK_RESEARCH.summary);
  });

  it('benchmarkEnabled + company + role set → onBenchmarkRole called first; onGenerate gets benchmarkPatterns', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onBenchmarkRole = vi.fn().mockResolvedValue(OK_BENCHMARK);
    const ctrl = await mount(buildHooks({ onGenerate, onBenchmarkRole }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'Senior SWE', jd: 'JD' });
    toggleFeature(ctrl, 'benchmark', true);

    clickGenerate(ctrl);
    await flush();

    expect(onBenchmarkRole).toHaveBeenCalledTimes(1);
    expect(onBenchmarkRole).toHaveBeenCalledWith({
      company: 'Acme',
      role: 'Senior SWE',
      model: HAIKU,
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);

    const benchIdx = onBenchmarkRole.mock.invocationCallOrder[0];
    const genIdx = onGenerate.mock.invocationCallOrder[0];
    expect(benchIdx).toBeLessThan(genIdx);

    const req = onGenerate.mock.calls[0][0];
    expect(req.benchmarkPatterns).toBe(OK_BENCHMARK.patterns);
  });

  it('multiVersionEnabled → onMultiVersion called; onGenerate NOT called; variant tabs rendered', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onMultiVersion = vi.fn().mockResolvedValue(OK_MULTI_VERSION);
    const ctrl = await mount(buildHooks({ onGenerate, onMultiVersion }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'multiVersion', true);

    clickGenerate(ctrl);
    await flush();

    expect(onMultiVersion).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();

    const mvCall = onMultiVersion.mock.calls[0][0];
    expect(mvCall.count).toBe(3);
    expect(mvCall.model).toBe(SONNET);
    expect(mvCall.company).toBe('Acme');
    expect(mvCall.role).toBe('SWE');

    // Variant tabs should be rendered in the resume slot.
    const resumeSlot = ctrl.root.querySelector('.generate__resume');
    expect(resumeSlot).not.toBeNull();
    const tabs = resumeSlot?.querySelectorAll('.mv-tab');
    expect(tabs?.length).toBe(3);
    expect(tabs?.[0].textContent).toBe('Technical depth');
    expect(resumeSlot?.querySelector('.mv-preview')?.textContent).toBe('# Variant 1');
  });

  it('showGenerateResult with critiqueEnabled → onCritique called with correct payload', async () => {
    const onCritique = vi.fn().mockResolvedValue(OK_CRITIQUE);
    const ctrl = await mount(buildHooks({ onCritique }));
    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD-body' });
    toggleFeature(ctrl, 'critique', true);
    await flush();

    ctrl.showGenerateResult(
      '# Resume MD',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
    );
    await flush();

    expect(onCritique).toHaveBeenCalledTimes(1);
    const req = onCritique.mock.calls[0][0];
    expect(req.resumeMd).toBe('# Resume MD');
    expect(req.jd).toBe('JD-body');
    expect(req.jobInsights).toBeNull();
    expect(req.jobFolderId).toBe('folderXYZ');
    expect(req.model).toBe(HAIKU);
  });

  it('showGenerateResult with coverLetterEnabled → onCoverLetter called; result renders Verify Hooks button', async () => {
    const onCoverLetter = vi.fn().mockResolvedValue(OK_COVER_LETTER);
    const ctrl = await mount(buildHooks({ onCoverLetter }));
    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    ctrl.showGenerateResult(
      '# Resume MD',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
    );
    await flush();

    expect(onCoverLetter).toHaveBeenCalledTimes(1);
    const req = onCoverLetter.mock.calls[0][0];
    expect(req.resumeMd).toBe('# Resume MD');
    expect(req.company).toBe('Acme');
    expect(req.role).toBe('SWE');
    expect(req.jobFolderId).toBe('folderXYZ');
    expect(req.model).toBe(HAIKU);

    // Verify-hooks button should now be rendered inside the cl-result slot.
    const clSlot = ctrl.root.querySelector('[data-role="cl-result"]');
    expect(clSlot).not.toBeNull();
    const verifyBtn = clSlot?.querySelector<HTMLButtonElement>('[data-action="verify-hooks"]');
    expect(verifyBtn).not.toBeNull();
    expect(verifyBtn?.textContent).toContain('Verify Hooks');
  });

  it('click Verify Hooks button → onVerifyClHooks called with the coverLetterMd from the prior CL response', async () => {
    const onCoverLetter = vi.fn().mockResolvedValue(OK_COVER_LETTER);
    const onVerifyClHooks = vi.fn().mockResolvedValue(OK_VERIFY_HOOKS);
    const ctrl = await mount(buildHooks({ onCoverLetter, onVerifyClHooks }));
    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    ctrl.showGenerateResult(
      '# Resume MD',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
    );
    await flush();

    const verifyBtn = ctrl.root.querySelector<HTMLButtonElement>(
      '[data-role="cl-result"] [data-action="verify-hooks"]',
    );
    expect(verifyBtn).not.toBeNull();
    verifyBtn?.click();
    await flush();

    expect(onVerifyClHooks).toHaveBeenCalledTimes(1);
    expect(onVerifyClHooks).toHaveBeenCalledWith({
      coverLetterMd: OK_COVER_LETTER.coverLetterMd,
      model: HAIKU,
    });
  });

  it('showGenerateResult with autoReviseEnabled → resume editor exposes revise-whole-resume button', async () => {
    const onAutoRevise = vi.fn().mockResolvedValue(OK_AUTO_REVISE);
    const ctrl = await mount(buildHooks({ onAutoRevise }));
    setMetaInputs(ctrl, { jd: 'JD' });
    toggleFeature(ctrl, 'autoRevise', true);
    await flush();

    ctrl.showGenerateResult(
      '# Resume MD\n\n## Experience\n\n### Engineer at Acme (2024)\n\n- Built a thing',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
    );
    await flush();

    // Per C2 stitch: the whole-resume button now lives inside the editor's
    // Preview tab, dispatched via the 'resume:revise' CustomEvent. The
    // legacy [data-revise-diff] button was removed.
    const reviseBtn = ctrl.root.querySelector<HTMLButtonElement>('button.revise-whole-resume');
    expect(reviseBtn).not.toBeNull();
    expect(reviseBtn?.textContent ?? '').toMatch(/revise.*whole.*resume/i);
  });

  it('toggling each v2 feature persists v2Toggles to storage', async () => {
    const mock = installChromeMock();
    const ctrl = await mount(buildHooks());

    // Toggle research on, then read back from storage.
    toggleFeature(ctrl, 'research', true);
    await flush();
    let stored = mock.__backing.get('v2Toggles') as V2TogglesState | undefined;
    expect(stored).toBeDefined();
    expect(stored?.researchEnabled).toBe(true);

    // Toggle critique on; storage should reflect both flips.
    toggleFeature(ctrl, 'critique', true);
    await flush();
    stored = mock.__backing.get('v2Toggles') as V2TogglesState | undefined;
    expect(stored?.researchEnabled).toBe(true);
    expect(stored?.critiqueEnabled).toBe(true);

    // Toggle benchmark + coverLetter on as well.
    toggleFeature(ctrl, 'benchmark', true);
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();
    stored = mock.__backing.get('v2Toggles') as V2TogglesState | undefined;
    expect(stored?.benchmarkEnabled).toBe(true);
    expect(stored?.coverLetterEnabled).toBe(true);
  });

  it('v2Toggles in storage on init → DOM reflects restored state (checkboxes, selects)', async () => {
    const mock = installChromeMock();
    const restored: V2TogglesState = {
      researchEnabled: true,
      researchModel: SONNET,
      benchmarkEnabled: true,
      benchmarkModel: SONNET,
      critiqueEnabled: true,
      critiqueModel: HAIKU,
      autoReviseEnabled: false,
      autoReviseModel: HAIKU,
      coverLetterEnabled: true,
      coverLetterModel: SONNET,
      coverLetterTone: 'neutral',
      verifyHooksModel: SONNET,
      multiVersionEnabled: true,
      multiVersionModel: SONNET,
      multiVersionCount: 4,
    };
    mock.__backing.set('v2Toggles', restored);

    const ctrl = await mount(buildHooks());

    // Probe each row's checkbox / model select / count select.
    const research = ctrl.root.querySelector<HTMLElement>('[data-feature="research"]');
    expect(research?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(research?.querySelector<HTMLSelectElement>('select.model-select')?.value).toBe(SONNET);

    const benchmark = ctrl.root.querySelector<HTMLElement>('[data-feature="benchmark"]');
    expect(benchmark?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(benchmark?.querySelector<HTMLSelectElement>('select.model-select')?.value).toBe(SONNET);

    const critique = ctrl.root.querySelector<HTMLElement>('[data-feature="critique"]');
    expect(critique?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);

    const autoRevise = ctrl.root.querySelector<HTMLElement>('[data-feature="autoRevise"]');
    expect(autoRevise?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);

    const cl = ctrl.root.querySelector<HTMLElement>('[data-feature="coverLetter"]');
    expect(cl?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(cl?.querySelector<HTMLSelectElement>('select.model-select')?.value).toBe(SONNET);

    const mv = ctrl.root.querySelector<HTMLElement>('[data-feature="multiVersion"]');
    expect(mv?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(mv?.querySelector<HTMLSelectElement>('select.model-select')?.value).toBe(SONNET);
    expect(mv?.querySelector<HTMLSelectElement>('select.count-select')?.value).toBe('4');

    const verify = ctrl.root.querySelector<HTMLElement>('[data-feature="verifyHooks"]');
    expect(verify?.querySelector<HTMLSelectElement>('select.model-select')?.value).toBe(SONNET);
  });

  it('hooks gracefully no-op when undefined (critiqueEnabled=true but no onCritique → console.warn / no throw)', async () => {
    // Spy on console.warn (some unwired-hook paths warn) and console.error.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Build hooks WITHOUT any v2 hook wired.
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const ctrl = await mount(buildHooks({ onGenerate }));
    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });

    // Turn on every v2 feature that has a graceful-no-op path on the pre-flight.
    toggleFeature(ctrl, 'research', true);
    toggleFeature(ctrl, 'benchmark', true);
    toggleFeature(ctrl, 'critique', true);
    toggleFeature(ctrl, 'autoRevise', true);
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    // Pre-flight: research + benchmark guard on the hook itself, so onGenerate
    // should still be called (no throw). researchSummary / benchmarkPatterns
    // remain undefined.
    expect(() => clickGenerate(ctrl)).not.toThrow();
    await flush();
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const req = onGenerate.mock.calls[0][0];
    expect(req.researchSummary).toBeUndefined();
    expect(req.benchmarkPatterns).toBeUndefined();

    // Post-gen: critique + cover letter both have `if (hook && enabled && jobFolderId)`
    // guards in runPostGenerateChain. No throw expected.
    expect(() =>
      ctrl.showGenerateResult(
        '# Resume MD',
        'https://docs.google.com/document/d/docABC/edit',
        'https://drive.google.com/drive/folders/folderXYZ',
      ),
    ).not.toThrow();
    await flush();

    // No errors thrown — multi-version warn path is exercised by the
    // dedicated test below.
    expect(errorSpy).not.toHaveBeenCalled();

    // Now exercise the multi-version warn path: enable multiVersion, click
    // generate without onMultiVersion wired → console.warn fires.
    toggleFeature(ctrl, 'multiVersion', true);
    await flush();
    warnSpy.mockClear();
    clickGenerate(ctrl);
    await flush();
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMsg).toMatch(/multi-version.*onMultiVersion/i);
  });
});
