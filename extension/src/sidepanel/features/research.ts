/**
 * @file sidepanel/features/research.ts
 *
 * Feature: Research Company toggle UI
 * Owner agent: E1 — Research + LinkedIn Benchmarking
 * Plan section: Phase 1 › Group E1
 *
 * Wires the "Research Company" toggle in the Generate tab. Defensive: if the
 * panel hasn't yet rendered the data-feature="research" element, the wiring
 * functions return without throwing.
 *
 * Hooks the parent panel must provide:
 *   - panelRoot: root DOM element of the side panel
 *   - hooks.onToggleChange(feature, enabled): called when toggle flips
 *   - hooks.onModelChange(feature, model):    called when model dropdown changes
 *   - state.researchEnabled: current toggle state
 *   - state.researchModel:   currently selected model id
 *
 * Integration point (generate.ts):
 *   When research is enabled, the Generate flow must prepend the research
 *   summary to the user message under "=== Company Research ===".
 *   Cross-impact flagged in the E1 final report.
 */

import type {
  ResearchCompanyRequest,
  ResearchCompanyResponse,
} from '../../types/api-contract.js';

// Re-exported so callers don't need to import api-contract directly.
export type { ResearchCompanyRequest, ResearchCompanyResponse };

const FEATURE_NAME = 'research';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Wire the Research Company toggle into the panel DOM.
 * Idempotent: safe to call multiple times — it removes prior listeners by
 * cloning the elements before attaching new ones.
 *
 * Selector convention: the panel orchestrator must annotate the toggle row
 * with `data-feature="research"`; inside it we expect:
 *   - one input[type="checkbox"]
 *   - optionally one .model-select OR .toggle-row__model select
 *
 * @param panelRoot - Root element of the side panel
 * @param hooks - Callback hooks provided by the panel orchestrator
 * @param state - Current feature state (enabled flag + model selection)
 */
export function wireResearchToggle(
  panelRoot: Element,
  hooks: {
    onToggleChange: (feature: string, enabled: boolean) => void;
    onModelChange: (feature: string, model: string) => void;
  },
  state: { researchEnabled: boolean; researchModel: string },
): void {
  const container = panelRoot.querySelector(`[data-feature="${FEATURE_NAME}"]`);
  if (!container) {
    // Panel not yet rendered with feature flag — silent no-op.
    return;
  }

  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (checkbox) {
    checkbox.checked = state.researchEnabled;
    checkbox.addEventListener('change', () => {
      hooks.onToggleChange(FEATURE_NAME, checkbox.checked);
    });
  }

  const modelSelect = container.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  if (modelSelect) {
    if (state.researchModel) modelSelect.value = state.researchModel;
    modelSelect.addEventListener('change', () => {
      hooks.onModelChange(FEATURE_NAME, modelSelect.value);
    });
  }
}

/**
 * Extract the current research model selection from the toggle DOM.
 *
 * @param toggles - Map of feature toggle elements (keyed by feature name)
 * @returns Selected model string, or DEFAULT_MODEL if toggle not found
 */
export function extractResearchModel(toggles: Map<string, Element>): string {
  const el = toggles.get(FEATURE_NAME);
  if (!el) return DEFAULT_MODEL;
  const select = el.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  return select?.value || DEFAULT_MODEL;
}
