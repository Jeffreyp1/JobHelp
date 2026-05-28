/**
 * @file sidepanel/features/multiVersion.ts
 *
 * Feature: Multi-version Generation UI
 * Owner agent: E4 — Multi-version
 * Plan section: Phase 1 › Group E4
 *
 * Wires the "Multi-version" toggle in the Generate tab:
 *   - Toggle checkbox (enable / disable multi-version mode)
 *   - Count selector (2, 3, 4, or 5 variants)
 *   - Model dropdown (which Claude model to use for the fan-out calls)
 *   - Variant tab strip (rendered after a multi_version response arrives)
 *   - "Save this version" button (saves the selected variant to the job folder)
 *
 * Multi-version is MUTUALLY EXCLUSIVE with the standard generate flow.
 * The generate.ts orchestrator handles the branch; this module owns only the
 * toggle wiring and result rendering.
 */

import type {
  MultiVersionRequest,
  MultiVersionResponse,
  MultiVersionVariant,
} from '../../types/api-contract.js';

export type { MultiVersionRequest, MultiVersionResponse, MultiVersionVariant };

// ---------------------------------------------------------------------------
// wireMultiVersionToggle
// ---------------------------------------------------------------------------

/**
 * Wire the Multi-version toggle, count selector, model dropdown, and result
 * tab strip inside the side panel.
 *
 * @param panelRoot  Root element of the side panel
 * @param hooks      Callbacks provided by the generate.ts orchestrator
 * @param state      Initial UI state
 */
export function wireMultiVersionToggle(
  panelRoot: Element,
  hooks: {
    onToggleChange: (feature: string, enabled: boolean) => void;
    onModelChange: (feature: string, model: string) => void;
    onCountChange?: (count: number) => void;
    onVariantSelect?: (variantIndex: number) => void;
    onMultiVersionResult?: (result: MultiVersionResponse) => void;
  },
  state: { multiVersionEnabled: boolean; multiVersionModel: string; multiVersionCount: number },
): void {
  // ── 1. Toggle checkbox ──────────────────────────────────────────────────

  const featureRoot = panelRoot.querySelector('[data-feature="multiVersion"]');
  if (!featureRoot) {
    console.warn('[multiVersion] data-feature="multiVersion" element not found');
    return;
  }

  const checkbox = featureRoot.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox) {
    checkbox.checked = state.multiVersionEnabled;
    checkbox.addEventListener('change', () => {
      hooks.onToggleChange('multiVersion', checkbox.checked);
    });
  }

  // ── 2. Model dropdown ───────────────────────────────────────────────────

  const modelSelect = featureRoot.querySelector<HTMLSelectElement>('select.model-select');
  if (modelSelect) {
    modelSelect.value = state.multiVersionModel;
    modelSelect.addEventListener('change', () => {
      hooks.onModelChange('multiVersion', modelSelect.value);
    });
  }

  // ── 3. Count selector ───────────────────────────────────────────────────

  const countSelect = featureRoot.querySelector<HTMLSelectElement>('select.count-select');
  if (countSelect) {
    countSelect.value = String(state.multiVersionCount);
    countSelect.addEventListener('change', () => {
      const parsed = parseInt(countSelect.value, 10);
      if (!isNaN(parsed)) {
        hooks.onCountChange?.(parsed);
      }
    });
  }

  // ── 4. Result rendering via onMultiVersionResult ────────────────────────
  // The generate.ts orchestrator calls hooks.onMultiVersionResult when the
  // multi_version API response arrives. We patch that hook to render the
  // tab strip inside featureRoot.

  const originalOnResult = hooks.onMultiVersionResult;
  hooks.onMultiVersionResult = (result: MultiVersionResponse) => {
    renderVariantTabs(panelRoot, featureRoot, result, hooks);
    originalOnResult?.(result);
  };
}

// ---------------------------------------------------------------------------
// renderVariantTabs
// ---------------------------------------------------------------------------

/**
 * Render the variant tab strip, preview area, cost summary, and
 * "Save this version" button after a multi_version response arrives.
 *
 * Layout injected into featureRoot:
 *   .mv-tabs          — horizontal row of <button> tabs
 *   .mv-preview       — <pre> or <div> showing the selected variant markdown
 *   .mv-cost          — cost summary line
 *   .mv-save          — "Save this version" button
 */
function renderVariantTabs(
  panelRoot: Element,
  featureRoot: Element,
  result: MultiVersionResponse,
  hooks: {
    onVariantSelect?: (variantIndex: number) => void;
  },
): void {
  // Remove any previous tab strip
  featureRoot.querySelectorAll('.mv-tabs, .mv-preview, .mv-cost, .mv-save').forEach(el => el.remove());

  if (!result.ok) {
    const errEl = document.createElement('p');
    errEl.className = 'mv-error';
    errEl.textContent = `Multi-version failed: ${result.error.message}`;
    featureRoot.appendChild(errEl);
    return;
  }

  const { variants, cost } = result;
  let selectedIndex = 0;

  // ── Tab strip ─────────────────────────────────────────────────────────

  const tabStrip = document.createElement('div');
  tabStrip.className = 'mv-tabs';

  // ── Preview area ──────────────────────────────────────────────────────

  const preview = document.createElement('pre');
  preview.className = 'mv-preview';

  // ── Cost summary ─────────────────────────────────────────────────────

  const costEl = document.createElement('p');
  costEl.className = 'mv-cost';
  costEl.textContent = `Total cost: $${cost.totalUsd.toFixed(4)} (${variants.length} variants)`;

  // ── Save button ───────────────────────────────────────────────────────

  const saveBtn = document.createElement('button');
  saveBtn.className = 'mv-save';
  saveBtn.textContent = 'Save this version';

  // ── Helper: activate a tab ────────────────────────────────────────────

  function showVariant(index: number): void {
    selectedIndex = index;
    const variant = variants[index];
    if (!variant) return;

    preview.textContent = variant.markdown;

    // Highlight active tab
    tabStrip.querySelectorAll('button').forEach((btn, i) => {
      btn.classList.toggle('mv-tab-active', i === index);
    });

    hooks.onVariantSelect?.(index);
  }

  // ── Build tabs ────────────────────────────────────────────────────────

  variants.forEach((v: MultiVersionVariant, i: number) => {
    const tab = document.createElement('button');
    tab.className = 'mv-tab';
    tab.textContent = v.label;
    tab.addEventListener('click', () => showVariant(i));
    tabStrip.appendChild(tab);
  });

  // ── Wire "Save this version" ──────────────────────────────────────────

  saveBtn.addEventListener('click', () => {
    const variant = variants[selectedIndex];
    if (!variant) return;

    // Dispatch a custom event that generate.ts can listen for.
    // Payload includes the selected markdown and the variant label.
    const event = new CustomEvent('multiversion:save', {
      bubbles: true,
      detail: { variantIndex: selectedIndex, label: variant.label, markdown: variant.markdown },
    });
    panelRoot.dispatchEvent(event);
  });

  // ── Mount into DOM ────────────────────────────────────────────────────

  featureRoot.appendChild(tabStrip);
  featureRoot.appendChild(preview);
  featureRoot.appendChild(costEl);
  featureRoot.appendChild(saveBtn);

  // Show first variant by default
  showVariant(0);
}

// ---------------------------------------------------------------------------
// extractMultiVersionModel
// ---------------------------------------------------------------------------

/**
 * Extract the current multi-version model selection from the toggle DOM.
 * Returns the model value if found; otherwise falls back to the default.
 */
export function extractMultiVersionModel(
  toggles: Map<string, Element>,
): string {
  const featureRoot = toggles.get('multiVersion');
  if (!featureRoot) return 'claude-sonnet-4-6';

  const modelSelect = featureRoot.querySelector<HTMLSelectElement>('select.model-select');
  if (modelSelect && modelSelect.value) return modelSelect.value;

  return 'claude-sonnet-4-6';
}

// ---------------------------------------------------------------------------
// extractMultiVersionCount
// ---------------------------------------------------------------------------

/**
 * Extract the current count selection from the toggle DOM.
 * Returns a number in [2, 5]; defaults to 3 if not found or invalid.
 */
export function extractMultiVersionCount(
  toggles: Map<string, Element>,
): number {
  const featureRoot = toggles.get('multiVersion');
  if (!featureRoot) return 3;

  const countSelect = featureRoot.querySelector<HTMLSelectElement>('select.count-select');
  if (countSelect) {
    const parsed = parseInt(countSelect.value, 10);
    if (!isNaN(parsed) && parsed >= 2 && parsed <= 5) return parsed;
  }

  return 3;
}
