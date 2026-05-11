/**
 * @file sidepanel/features/critique.ts
 *
 * Feature: Critique toggle UI
 * Owner agent: E2 — Critique + Auto-revise
 *
 * Wires the "Critique" toggle in the Generate tab and provides a renderer for
 * the 8-dimension score card and tiered improvement list. The actual API call
 * is owned by the orchestrator (generate.ts integration point); this module
 * only covers DOM wiring and result rendering.
 *
 * Selector convention: the panel orchestrator must annotate the toggle row
 * with `data-feature="critique"`. Inside it we expect:
 *   - one input[type="checkbox"]
 *   - optionally one select.model-select or select.toggle-row__model
 *
 * Result rendering: when a critique result arrives, the orchestrator can
 * call renderCritiqueResult(panelRoot, result) to populate (or create) a
 * `[data-critique-result]` element with the score table + improvement list.
 *
 * ⚠ CROSS-IMPACT: extension/src/sidepanel/tabs/generate.ts must be updated to
 * (1) call api.critique() after generate completes when critiqueEnabled and
 * (2) hand the response to renderCritiqueResult. Owner: orchestrator.
 */

import type {
  CritiqueRequest,
  CritiqueResponse,
  CritiqueScore,
  CritiqueImprovement,
} from '../../types/api-contract.js';

export type { CritiqueRequest, CritiqueResponse, CritiqueScore, CritiqueImprovement };

const FEATURE_NAME = 'critique';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Wire the Critique toggle into the panel DOM.
 *
 * Idempotent: re-binding listeners on top of existing ones is the caller's
 * responsibility (this function attaches once per call).
 */
export function wireCritiqueToggle(
  panelRoot: Element,
  hooks: {
    onToggleChange: (feature: string, enabled: boolean) => void;
    onModelChange: (feature: string, model: string) => void;
    onCritiqueResult?: (result: CritiqueResponse) => void;
  },
  state: { critiqueEnabled: boolean; critiqueModel: string },
): void {
  const container = panelRoot.querySelector(`[data-feature="${FEATURE_NAME}"]`);
  if (!container) return;

  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox) {
    checkbox.checked = state.critiqueEnabled;
    checkbox.addEventListener('change', () => {
      hooks.onToggleChange(FEATURE_NAME, checkbox.checked);
    });
  }

  const modelSelect = container.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  if (modelSelect) {
    if (state.critiqueModel) modelSelect.value = state.critiqueModel;
    modelSelect.addEventListener('change', () => {
      hooks.onModelChange(FEATURE_NAME, modelSelect.value);
    });
  }

  // Bridge: if orchestrator provides onCritiqueResult, expose a hook on the
  // container so it can be invoked from generate.ts after API completes.
  if (hooks.onCritiqueResult) {
    (container as unknown as { __critiqueResultHook?: typeof hooks.onCritiqueResult })
      .__critiqueResultHook = hooks.onCritiqueResult;
  }
}

/**
 * Extract the current critique model selection from the toggle DOM.
 */
export function extractCritiqueModel(toggles: Map<string, Element>): string {
  const el = toggles.get(FEATURE_NAME);
  if (!el) return DEFAULT_MODEL;
  const select = el.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  return select?.value || DEFAULT_MODEL;
}

/**
 * Render the critique result into a `[data-critique-result]` container under
 * panelRoot. If the container does not exist, this function is a no-op.
 *
 * Layout:
 *   - h3 Critique
 *   - p Total: X/10
 *   - table of dimension scores
 *   - ul tiered improvements
 *   - link to critique doc (if any)
 */
export function renderCritiqueResult(
  panelRoot: Element,
  result: CritiqueResponse,
): void {
  const target = panelRoot.querySelector('[data-critique-result]');
  if (!target) return;

  if (!result.ok) {
    target.innerHTML = `<div class="critique-error">Critique failed: ${escapeHtml(result.error.message)}</div>`;
    return;
  }

  const rows = result.scores
    .map(
      (s: CritiqueScore) =>
        `<tr><td>${escapeHtml(s.dimension)}</td><td>${s.score}</td><td>${s.weight}</td><td>${escapeHtml(s.notes)}</td></tr>`,
    )
    .join('');

  const tiered = ([1, 2, 3] as const)
    .map((tier) => {
      const items = result.improvements.filter((i: CritiqueImprovement) => i.tier === tier);
      if (items.length === 0) return '';
      const lis = items
        .map((i) => `<li>${escapeHtml(i.text)} <small>(Δ ${i.expectedDelta.toFixed(2)})</small></li>`)
        .join('');
      return `<h4>Tier ${tier}</h4><ul>${lis}</ul>`;
    })
    .join('');

  const docLink = result.critiqueDocUrl
    ? `<p><a href="${escapeHtml(result.critiqueDocUrl)}" target="_blank" rel="noopener">View saved critique.md</a></p>`
    : '';

  target.innerHTML = [
    `<h3>Critique</h3>`,
    `<p><strong>Total weighted score:</strong> ${result.totalScore.toFixed(2)} / 10</p>`,
    `<table class="critique-scores"><thead><tr><th>Dimension</th><th>Score</th><th>Weight</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="critique-improvements">${tiered}</div>`,
    docLink,
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
