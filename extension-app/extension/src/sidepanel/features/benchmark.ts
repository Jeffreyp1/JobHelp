/**
 * @file sidepanel/features/benchmark.ts
 *
 * Feature: Benchmark Role toggle UI
 * Owner agent: E1 — Research + LinkedIn Benchmarking
 * Plan section: Phase 1 › Group E1
 *
 * Wires the "LinkedIn Role Benchmark" toggle in the Generate tab. Defensive:
 * if the panel hasn't yet rendered the data-feature="benchmark" element, the
 * wiring functions return without throwing.
 *
 * Hooks the parent panel must provide:
 *   - panelRoot: root DOM element of the side panel
 *   - hooks.onToggleChange(feature, enabled): called when toggle flips
 *   - hooks.onModelChange(feature, model):    called when model dropdown changes
 *   - state.benchmarkEnabled: current toggle state
 *   - state.benchmarkModel:   currently selected model id
 *
 * Integration point (generate.ts):
 *   When benchmark is enabled, the Generate flow must prepend the benchmark
 *   patterns to the user message under "=== Role Benchmark ===".
 */

import type {
  BenchmarkRoleRequest,
  BenchmarkRoleResponse,
} from '../../types/api-contract.js';

export type { BenchmarkRoleRequest, BenchmarkRoleResponse };

const FEATURE_NAME = 'benchmark';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Wire the Benchmark Role toggle into the panel DOM.
 *
 * Selector convention: the panel orchestrator must annotate the toggle row
 * with `data-feature="benchmark"`; inside it we expect:
 *   - one input[type="checkbox"]
 *   - optionally one .model-select OR .toggle-row__model select
 */
export function wireBenchmarkToggle(
  panelRoot: Element,
  hooks: {
    onToggleChange: (feature: string, enabled: boolean) => void;
    onModelChange: (feature: string, model: string) => void;
  },
  state: { benchmarkEnabled: boolean; benchmarkModel: string },
): void {
  const container = panelRoot.querySelector(`[data-feature="${FEATURE_NAME}"]`);
  if (!container) return;

  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (checkbox) {
    checkbox.checked = state.benchmarkEnabled;
    checkbox.addEventListener('change', () => {
      hooks.onToggleChange(FEATURE_NAME, checkbox.checked);
    });
  }

  const modelSelect = container.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  if (modelSelect) {
    if (state.benchmarkModel) modelSelect.value = state.benchmarkModel;
    modelSelect.addEventListener('change', () => {
      hooks.onModelChange(FEATURE_NAME, modelSelect.value);
    });
  }
}

/**
 * Extract the current benchmark model selection from the toggle DOM.
 *
 * @param toggles - Map of feature toggle elements (keyed by feature name)
 * @returns Selected model string, or DEFAULT_MODEL if toggle not found
 */
export function extractBenchmarkModel(toggles: Map<string, Element>): string {
  const el = toggles.get(FEATURE_NAME);
  if (!el) return DEFAULT_MODEL;
  const select = el.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  return select?.value || DEFAULT_MODEL;
}
