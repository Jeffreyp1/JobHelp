/** @vitest-environment jsdom */
/**
 * v2-flow.test.ts
 *
 * Integration probes for the v2 orchestration in renderGenerateTab.
 * Each test targets a specific silent-failure mode in the request-shape
 * round-trip OR the state-machine transitions between feature toggles.
 *
 * Tests are written to FAIL when behavior is suspicious; passing tests carry
 * a `// SILENT BEHAVIOR:` comment documenting what we confirmed.
 *
 * Mocking approach mirrors extension/tests/sidepanel/generate.test.ts:
 *   - installChromeMock() backs chrome.storage with an in-memory Map.
 *   - All v2 hooks are vi.fn() mocks the test wires up explicitly.
 *   - No source code under test is mocked — we exercise the real
 *     orchestration in generate.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderGenerateTab } from '../../src/sidepanel/tabs/generate';
import type {
  GenerateTabHooks,
  GenerateTabController,
} from '../../src/sidepanel/tabs/generate';
import { setRuntimeConfig } from '../../src/sidepanel/index';
import type { JobhelpConfig } from '../../src/types/jobhelp-config';
import type {
  ResearchCompanyResponse,
  BenchmarkRoleResponse,
  CritiqueResponse,
  CoverLetterResponse,
  VerifyClHooksResponse,
  MultiVersionResponse,
} from '../../src/types/api-contract';
import type { V2TogglesState } from '../../src/types/storage-schema';
import { installChromeMock } from '../helpers/chrome-mocks';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

/** Fixture JobhelpConfig — primes getRuntimeConfig() so the Generate tab works. */
const TEST_CONFIG: JobhelpConfig = {
  anthropicApiKey: 'sk-ant-test',
  appsScriptUrl: 'https://script.google.com/macros/s/test/exec',
  folders: { source: 'srcFolderId', rules: 'rulesFolderId', output: 'outFolderId' },
  sheetId: 'trackingSheetId',
  templateDocxId: 'templateDocxId',
  defaults: { model: HAIKU, togglePreset: 'default' },
  preferences: { autoConvertOnGenerate: false, showCostInline: true },
};

// ─── fixtures ───────────────────────────────────────────────────────

const OK_RESEARCH: ResearchCompanyResponse = {
  ok: true,
  summary: 'COMPANY_RESEARCH_SUMMARY_SENTINEL — Acme is a SaaS company; Series C.',
  keywords: ['saas', 'series c'],
  sources: [{ title: 'TC', url: 'https://example.com/tc' }],
  cached: false,
  cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
};

const OK_BENCHMARK: BenchmarkRoleResponse = {
  ok: true,
  patterns: 'ROLE_BENCHMARK_PATTERNS_SENTINEL — Senior IC pattern: 5+ YOE; distributed systems.',
  keywords: ['distributed', 'systems'],
  sources: [{ title: 'LI', url: 'https://example.com/li' }],
  cached: false,
  cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
};

const OK_CRITIQUE: CritiqueResponse = {
  ok: true,
  scores: [{ dimension: 'k', score: 8, weight: 1, notes: 'good' }],
  totalScore: 8,
  improvements: [{ tier: 1, text: 'Add metrics', expectedDelta: 0.5 }],
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
    { entity: 'Dr. Foo', entityType: 'PI name', status: 'verified', sources: [] },
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

// ─── helpers ────────────────────────────────────────────────────────

function buildHooks(overrides: Partial<GenerateTabHooks> = {}): GenerateTabHooks {
  return {
    onGenerate: vi.fn().mockResolvedValue(undefined),
    onSaveResume: vi.fn().mockResolvedValue(undefined),
    onFinalize: vi.fn().mockResolvedValue({ ok: false, message: 'stub' }),
    ...overrides,
  };
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

async function mount(hooks: GenerateTabHooks): Promise<GenerateTabController> {
  const ctrl = renderGenerateTab(hooks);
  await flush();
  return ctrl;
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

function toggleFeature(
  ctrl: GenerateTabController,
  featureKey: string,
  enabled: boolean,
): void {
  const row = ctrl.root.querySelector<HTMLElement>(`[data-feature="${featureKey}"]`);
  if (!row) throw new Error(`feature row ${featureKey} not found`);
  const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!cb) throw new Error(`checkbox not found in ${featureKey}`);
  if (cb.checked !== enabled) {
    cb.checked = enabled;
    cb.dispatchEvent(new Event('change'));
  }
}

function setModelOnRow(
  ctrl: GenerateTabController,
  featureKey: string,
  model: string,
): void {
  const row = ctrl.root.querySelector<HTMLElement>(`[data-feature="${featureKey}"]`);
  if (!row) throw new Error(`feature row ${featureKey} not found`);
  const sel = row.querySelector<HTMLSelectElement>('select.model-select');
  if (!sel) throw new Error(`model select not found in ${featureKey}`);
  sel.value = model;
  sel.dispatchEvent(new Event('change'));
}

// ─── tests ──────────────────────────────────────────────────────────

describe('v2-flow integration probes', () => {
  beforeEach(() => {
    installChromeMock();
    setRuntimeConfig(TEST_CONFIG);
    if (!('scrollIntoView' in Element.prototype)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Element.prototype as any).scrollIntoView = function () {};
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setRuntimeConfig(null);
  });

  // ─── PROBE 1: research summary truthfully prepended ─────────────

  it('V1: research summary string round-trips intact into onGenerate request', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onResearchCompany = vi.fn().mockResolvedValue(OK_RESEARCH);
    const ctrl = await mount(buildHooks({ onGenerate, onResearchCompany }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'research', true);

    clickGenerate(ctrl);
    await flush();

    expect(onResearchCompany).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledTimes(1);

    const req = onGenerate.mock.calls[0][0];
    // Truthfulness assertion: the EXACT sentinel string must arrive in
    // researchSummary. If the orchestration substitutes "summary" with
    // some other field (e.g. it pulls .keywords by mistake), this fails.
    expect(req.researchSummary).toBe(OK_RESEARCH.summary);
    expect(req.researchSummary).toContain('COMPANY_RESEARCH_SUMMARY_SENTINEL');
    // SILENT BEHAVIOR (passing): researchSummary correctly carries the
    // exact sentinel from the research hook response into the generate
    // request body. No silent substitution / truncation observed.
  });

  // ─── PROBE 2: benchmark patterns truthfully prepended ───────────

  it('V2: benchmark patterns string round-trips intact into onGenerate request', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onBenchmarkRole = vi.fn().mockResolvedValue(OK_BENCHMARK);
    const ctrl = await mount(buildHooks({ onGenerate, onBenchmarkRole }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'Senior SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'benchmark', true);

    clickGenerate(ctrl);
    await flush();

    const req = onGenerate.mock.calls[0][0];
    expect(req.benchmarkPatterns).toBe(OK_BENCHMARK.patterns);
    expect(req.benchmarkPatterns).toContain('ROLE_BENCHMARK_PATTERNS_SENTINEL');
    // SILENT BEHAVIOR (passing): benchmarkPatterns correctly carries the
    // exact patterns sentinel into the generate request body.
  });

  // ─── PROBE 3: multiVersion + critique=on → critique NOT fired ────

  it('V3: multiVersion + critique=on → critique is NOT fired (multi-version is mutually exclusive)', async () => {
    // The generate tab takes the multi-version branch and returns BEFORE
    // calling onGenerate. showGenerateResult is therefore never called by
    // the user-facing happy path, so the post-gen critique chain should not
    // run. Probe: assert critique stays cold.
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onCritique = vi.fn().mockResolvedValue(OK_CRITIQUE);
    const onMultiVersion = vi.fn().mockResolvedValue(OK_MULTI_VERSION);
    const ctrl = await mount(buildHooks({ onGenerate, onCritique, onMultiVersion }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'multiVersion', true);
    toggleFeature(ctrl, 'critique', true);

    clickGenerate(ctrl);
    await flush();

    expect(onMultiVersion).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
    // SILENT BEHAVIOR: critique is not auto-triggered by the multi-version
    // branch because showGenerateResult is never called. The user must
    // pick a variant and the "Save this version" button currently just
    // calls showResume (no post-gen chain). This is documented as expected:
    // the post-gen chain is keyed off showGenerateResult, not showResume.
    expect(onCritique).not.toHaveBeenCalled();
  });

  // ─── PROBE 4: coverLetterEnabled but null jobFolderId ────────────

  it('V4: coverLetterEnabled=true but jobFolderUrl yields no parseable folder id → CL skips silently (no call)', async () => {
    // Probe: if the generate result returns a malformed jobFolderUrl that
    // doesn't match /folders/<id>/, jobFolderId comes back null. runPostGenerateChain
    // requires jobFolderId to be truthy before invoking onCoverLetter. Verify
    // that this silent skip happens.
    const onCoverLetter = vi.fn().mockResolvedValue(OK_COVER_LETTER);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = await mount(buildHooks({ onCoverLetter }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    // Pass a URL that does NOT match /folders/(<id>) → extractFolderId returns null.
    ctrl.showGenerateResult(
      '# Resume',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/this-is-not-a-folder-url',
    );
    await flush();

    // SILENT BEHAVIOR: CL is silently skipped when jobFolderId can't be
    // extracted. There's a console.warn that "could not extract IDs" but
    // NO user-facing banner. The user sees the CL toggle was on but no
    // CL appears — they have to inspect dev-tools to find out why. This
    // is a documented silent-failure surface and a candidate for a UX
    // improvement (surface an inline banner).
    expect(onCoverLetter).not.toHaveBeenCalled();
    // The warn fires only the once, and is the only one we expect here.
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMsg).toMatch(/could not extract ids/i);
  });

  // ─── PROBE 5: Verify-hooks runs only after CL produces result ────

  it('V5: verify-hooks is only invokable after CL produces a result (no premature button)', async () => {
    // Probe: in the time window between "click Generate" and "CL result
    // renders", there should be NO verify-hooks button in the DOM.
    // Otherwise a race could let the user click verify-hooks before the
    // CL is ready.
    const onCoverLetter = vi.fn(() => new Promise<CoverLetterResponse>(() => {
      // never resolves — leave the CL request pending
    }));
    const onVerifyClHooks = vi.fn().mockResolvedValue(OK_VERIFY_HOOKS);
    const ctrl = await mount(buildHooks({ onCoverLetter, onVerifyClHooks }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    // Trigger the post-gen chain; CL never resolves.
    ctrl.showGenerateResult(
      '# Resume',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
    );
    await flush();

    // SILENT BEHAVIOR: no verify-hooks button rendered while the CL
    // request is still pending. The button only appears after CL resolves
    // (renderCoverLetterResult builds it). No race condition observed —
    // the button is created by the same renderer that consumes the CL
    // markdown, so it can never reference a stale/missing CL.
    const verifyBtn = ctrl.root.querySelector<HTMLButtonElement>(
      '[data-role="cl-result"] [data-action="verify-hooks"]',
    );
    expect(verifyBtn).toBeNull();
    expect(onVerifyClHooks).not.toHaveBeenCalled();
  });

  // ─── PROBE 6: onGenerate hook throwing ─────────────────────────────

  it('V6: onGenerate that throws → error is NOT surfaced to status banner (silent crash)', async () => {
    // Probe: the click handler in generate.ts awaits hooks.onGenerate(req).
    // If onGenerate THROWS instead of resolving, what happens to the UI?
    // Currently the click handler doesn't try/catch around onGenerate, so
    // the rejection propagates as an "Uncaught (in promise)". The user
    // sees the busy state never clears AND no error banner appears.
    //
    // BUG SURFACED: extension/src/sidepanel/tabs/generate.ts:697 awaits
    // onGenerate WITHOUT any surrounding try/catch — the rejection is lost
    // to the user. The fix is to wrap in try/catch + write the error to
    // statusEl.textContent (mirror the multi-version branch behavior).

    // Install a global unhandledrejection swallow so the test runner
    // doesn't flag the deliberately-uncaught rejection.
    const swallow = (e: PromiseRejectionEvent): void => {
      if (
        e?.reason instanceof Error &&
        /SIMULATED_ONGENERATE_THROW/.test(e.reason.message)
      ) {
        e.preventDefault?.();
      }
    };
    // Attach via process (Node) AND window (jsdom) so vitest's runner trap
    // sees handled.
    if (typeof process !== 'undefined' && process.on) {
      process.on('unhandledRejection', swallow as unknown as () => void);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('unhandledrejection', swallow as EventListener);
    }

    try {
      const error = new Error('SIMULATED_ONGENERATE_THROW');
      const onGenerate = vi.fn().mockRejectedValue(error);
      const ctrl = await mount(buildHooks({ onGenerate }));

      setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', jd: 'JD' });

      clickGenerate(ctrl);
      // Allow rejection + microtask drain
      await flush(6);

      // SILENT BEHAVIOR / BUG: status banner does NOT show the error.
      // Asserting the CORRECT behavior (statusEl shows the error message)
      // fails until the bug is fixed. This test is intentionally written
      // to FAIL — the assertion encodes the desired post-fix behavior.
      const statusEl = ctrl.root.querySelector('.generate__status');
      // ASSERT THE CORRECT BEHAVIOR — this WILL FAIL today, exposing the bug.
      expect(statusEl?.textContent ?? '').toMatch(/SIMULATED_ONGENERATE_THROW/);
    } finally {
      if (typeof process !== 'undefined' && process.off) {
        process.off('unhandledRejection', swallow as unknown as () => void);
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('unhandledrejection', swallow as EventListener);
      }
    }
  });

  // ─── PROBE 7: onResearchCompany returns ok:false → researchSummary undefined

  it('V7: onResearchCompany returns ok:false → researchSummary stays undefined in onGenerate', async () => {
    // Probe: if research fails (cached miss + transport error), the
    // researchSummary must NOT be carried forward as the .error.message
    // or as a stringified failure object. It must be undefined so the
    // backend buildUserMessage drops the "=== Company Research ===" block.
    const failed: ResearchCompanyResponse = {
      ok: false,
      error: { type: 'server', message: 'rate limited', retryable: true },
    };
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onResearchCompany = vi.fn().mockResolvedValue(failed);
    const ctrl = await mount(buildHooks({ onGenerate, onResearchCompany }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'research', true);

    clickGenerate(ctrl);
    await flush();

    const req = onGenerate.mock.calls[0][0];
    // SILENT BEHAVIOR (passing): researchSummary is left undefined when the
    // research call returns ok:false. The orchestration logs a warn but
    // does NOT halt the generate — the user sees the resume generated
    // without the research block, with no inline banner. Documented as
    // graceful-degradation behavior, but the user has no signal that
    // research silently failed.
    expect(req.researchSummary).toBeUndefined();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  // ─── PROBE 8: Toggle off after a feature ran → next click skips it

  it('V8: toggling research OFF after it fired once → next click does NOT re-fire research', async () => {
    // Probe: the orchestration must read state.researchEnabled each click,
    // not memoize that the feature was "armed" earlier in the session.
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onResearchCompany = vi.fn().mockResolvedValue(OK_RESEARCH);
    const ctrl = await mount(buildHooks({ onGenerate, onResearchCompany }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'research', true);

    clickGenerate(ctrl);
    await flush();
    expect(onResearchCompany).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledTimes(1);

    // Toggle OFF, click again — research should NOT fire a second time.
    toggleFeature(ctrl, 'research', false);
    await flush();

    clickGenerate(ctrl);
    await flush();

    // SILENT BEHAVIOR (passing): research toggles off cleanly. The orch
    // reads state.researchEnabled on each click — there's no leaked
    // "armed" flag.
    expect(onResearchCompany).toHaveBeenCalledTimes(1); // still 1
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  // ─── PROBE 9: Cost preview updates on model change mid-session ─

  it('V9: changing the generate model mid-session updates the cost preview text', async () => {
    // Probe: switching the generate model should re-render the cost block.
    // The cost preview is the only signal the user gets that "this click
    // will cost more than the last one".
    const ctrl = await mount(buildHooks());

    // Capture initial cost text.
    const costContainer = ctrl.root.querySelector<HTMLElement>('.generate__cost');
    expect(costContainer).not.toBeNull();
    const initialText = costContainer?.textContent ?? '';

    // Swap to opus (75x more expensive than haiku output).
    const generateRow = ctrl.root.querySelector<HTMLElement>('.toggle-row');
    expect(generateRow).not.toBeNull();
    const modelSel = generateRow?.querySelector<HTMLSelectElement>('select.model-select');
    expect(modelSel).not.toBeNull();
    if (modelSel) {
      modelSel.value = OPUS;
      modelSel.dispatchEvent(new Event('change'));
    }
    await flush();

    const afterText = costContainer?.textContent ?? '';
    // SILENT BEHAVIOR (passing): cost preview re-renders when the generate
    // model dropdown changes. The text difference is observable to the
    // user immediately. No console.warn or other signal needed — the
    // dollar amount is visibly different.
    expect(afterText).not.toBe(initialText);
  });

  // ─── PROBE 10: Restore unknown model from storage ──────────────

  it('V10: v2Toggles from storage with an unknown model string → restored as-is (silent), no validation, no reset', async () => {
    // Probe: the storage-restore IIFE in generate.ts trusts whatever it
    // pulls from storage. If a previous version saved a model id that's
    // no longer in ALL_MODELS, what happens?
    // - The state field is set to the bogus string.
    // - The DOM <select>.value is set to the bogus value, which HTML
    //   silently drops (selectedIndex becomes -1, value becomes '').
    // - The cost preview then receives a model string that PRICING_PER_M
    //   doesn't recognize → falls back to haiku pricing silently.
    // Net: user's restored toggle silently reverts to "no model selected"
    // in the DOM and "haiku cost" in the preview, with NO warning.
    const mock = installChromeMock();
    const restored: V2TogglesState = {
      researchEnabled: true,
      researchModel: 'claude-fictional-XYZ-9000',
      benchmarkEnabled: false,
      benchmarkModel: HAIKU,
      critiqueEnabled: false,
      critiqueModel: HAIKU,
      autoReviseEnabled: false,
      autoReviseModel: HAIKU,
      coverLetterEnabled: false,
      coverLetterModel: HAIKU,
      coverLetterTone: 'neutral',
      verifyHooksModel: HAIKU,
      multiVersionEnabled: false,
      multiVersionModel: SONNET,
      multiVersionCount: 3,
    };
    mock.__backing.set('v2Toggles', restored);

    const ctrl = await mount(buildHooks());

    const researchRow = ctrl.root.querySelector<HTMLElement>('[data-feature="research"]');
    const researchSel = researchRow?.querySelector<HTMLSelectElement>('select.model-select');

    // SILENT BEHAVIOR: the <select> value will be "" (no matching option)
    // because the browser drops the unrecognized value. No console.warn,
    // no banner, the user sees an empty dropdown and the cost preview
    // silently falls back to default pricing. This is a real silent
    // failure surface — the storage-restore code at
    // extension/src/sidepanel/tabs/generate.ts:1054 should validate the
    // model against ALL_MODELS and fall back to defaultGenerateModel if
    // unknown, ideally with a console.warn.
    // FAILING ASSERTION: we assert the CORRECT behavior (the select
    // value should be one of ALL_MODELS), so this test will FAIL until
    // the bug is fixed.
    const validModels = [HAIKU, SONNET, OPUS];
    expect(validModels).toContain(researchSel?.value ?? '');
  });

  // ─── PROBE 11: sheetId + rowUrl reach the v2 post-gen handlers ──

  it('V11: showGenerateResult with a sheetRowUrl → critique + cover letter both receive sheetId and rowUrl', async () => {
    // Probe: the v2 handlers can only update the tracking sheet's result
    // columns if generate.ts forwards { sheetId, rowUrl }. sheetId comes
    // from getRuntimeConfig(); rowUrl is the 4th arg of showGenerateResult
    // (the generate result's sheetRowUrl). If either is dropped, the sheet
    // columns silently stay blank.
    const SHEET_ROW_URL =
      'https://docs.google.com/spreadsheets/d/trackingSheetId/edit#gid=0&range=A12';
    const onCritique = vi.fn().mockResolvedValue(OK_CRITIQUE);
    const onCoverLetter = vi.fn().mockResolvedValue(OK_COVER_LETTER);
    const ctrl = await mount(buildHooks({ onCritique, onCoverLetter }));

    setMetaInputs(ctrl, { company: 'Acme', role: 'SWE', url: 'https://e.x', jd: 'JD' });
    toggleFeature(ctrl, 'critique', true);
    toggleFeature(ctrl, 'coverLetter', true);
    await flush();

    ctrl.showGenerateResult(
      '# Resume',
      'https://docs.google.com/document/d/docABC/edit',
      'https://drive.google.com/drive/folders/folderXYZ',
      SHEET_ROW_URL,
    );
    await flush();

    expect(onCritique).toHaveBeenCalledTimes(1);
    expect(onCoverLetter).toHaveBeenCalledTimes(1);
    const critReq = onCritique.mock.calls[0][0];
    const clReq = onCoverLetter.mock.calls[0][0];
    // SILENT BEHAVIOR (passing post-fix): sheetId + rowUrl truthfully forwarded
    // to both v2 post-gen handlers so they can write the sheet columns.
    expect(critReq.sheetId).toBe('trackingSheetId');
    expect(critReq.rowUrl).toBe(SHEET_ROW_URL);
    expect(clReq.sheetId).toBe('trackingSheetId');
    expect(clReq.rowUrl).toBe(SHEET_ROW_URL);
  });
});
