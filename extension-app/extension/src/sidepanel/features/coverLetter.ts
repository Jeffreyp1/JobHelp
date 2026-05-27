/**
 * @file sidepanel/features/coverLetter.ts
 *
 * Feature: Cover Letter toggle UI
 * Owner agent: E3 — Cover Letter + Verify CL Hooks
 * Plan section: Phase 1 › Group E3
 *
 * This module wires the "Cover Letter" toggle in the Generate tab.
 * When enabled, the Generate flow also calls the cover_letter action after
 * generate completes, saving the CL to the same job folder.
 *
 * Post-generate integration (generate.ts "// TODO: v2 coverLetter"):
 *   After generate completes, if coverLetterEnabled=true, call api.coverLetter({
 *     resumeMd: result.resumeMd, jd, company, role,
 *     sourceFolderId, rulesFolderId, jobFolderId: <from result>, model
 *   }) and pass result to hooks.onCoverLetterResult.
 *
 * UI responsibilities after result arrives:
 *   - Show link to cover_letter.md in Drive
 *   - Show link to Google Doc version
 *   - Show "Verify Hooks" button (triggers verifyHooks feature)
 *   - Show word count (must be 250-300)
 */

import type {
  CoverLetterRequest,
  CoverLetterResponse,
} from '../../types/api-contract.js';

export type { CoverLetterRequest, CoverLetterResponse };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// wireCoverLetterToggle
// ---------------------------------------------------------------------------

/**
 * Wire the Cover Letter toggle into the panel DOM.
 *
 *   1. Find toggle checkbox by data-feature="coverLetter"
 *   2. Register 'change' → hooks.onToggleChange('coverLetter', checked)
 *   3. Find model dropdown; register 'change' → hooks.onModelChange
 *   4. Set initial UI state from `state`
 *   5. Wire hooks.onCoverLetterResult to show drive link + word count
 *   6. Render "Verify Hooks" button that triggers verifyHooks feature
 */
export function wireCoverLetterToggle(
  panelRoot: Element,
  hooks: {
    onToggleChange: (feature: string, enabled: boolean) => void;
    onModelChange: (feature: string, model: string) => void;
    onCoverLetterResult?: (result: CoverLetterResponse) => void;
  },
  state: { coverLetterEnabled: boolean; coverLetterModel: string },
): void {
  // ── 1. Find the toggle checkbox ──────────────────────────────────────────
  const checkbox = panelRoot.querySelector<HTMLInputElement>(
    '[data-feature="coverLetter"] input[type="checkbox"]',
  );
  if (checkbox) {
    // Set initial state
    checkbox.checked = state.coverLetterEnabled;

    // 2. Register change handler
    checkbox.addEventListener('change', () => {
      hooks.onToggleChange('coverLetter', checkbox.checked);
    });
  }

  // ── 3. Find model dropdown ───────────────────────────────────────────────
  const modelSelect = panelRoot.querySelector<HTMLSelectElement>(
    '[data-feature="coverLetter"] select[data-role="model"]',
  );
  if (modelSelect) {
    // Set initial value
    modelSelect.value = state.coverLetterModel;

    modelSelect.addEventListener('change', () => {
      hooks.onModelChange('coverLetter', modelSelect.value);
    });
  }

  // ── 5. Wire result display ───────────────────────────────────────────────
  if (hooks.onCoverLetterResult) {
    const originalCallback = hooks.onCoverLetterResult;
    hooks.onCoverLetterResult = (result: CoverLetterResponse) => {
      // Show result in the panel
      _renderCoverLetterResult(panelRoot, result);
      // Call the original hook too
      originalCallback(result);
    };
  }
}

/**
 * Render the cover letter result into the panel DOM.
 * Shows Drive link, Google Doc link, word count, and Verify Hooks button.
 */
function _renderCoverLetterResult(panelRoot: Element, result: CoverLetterResponse): void {
  const resultContainer = panelRoot.querySelector('[data-role="cl-result"]');
  if (!resultContainer) return;

  if (!result.ok) {
    resultContainer.innerHTML = `
      <div class="cl-error">
        <span class="error-icon">⚠</span>
        <span class="error-msg">${escapeHtml(result.error.message)}</span>
        ${result.error.retryable ? '<button data-action="cl-retry">Retry</button>' : ''}
      </div>
    `;
    return;
  }

  const wc = wordCount(result.coverLetterMd);
  const wcClass = wc >= 250 && wc <= 300 ? 'wc-ok' : 'wc-warn';

  resultContainer.innerHTML = `
    <div class="cl-success">
      <div class="cl-links">
        ${result.mdFileUrl ? `<a href="${escapeHtml(result.mdFileUrl)}" target="_blank" rel="noopener">cover_letter.md ↗</a>` : ''}
        ${result.docUrl ? `<a href="${escapeHtml(result.docUrl)}" target="_blank" rel="noopener">Google Doc ↗</a>` : ''}
      </div>
      <div class="cl-meta">
        <span class="${wcClass}">${wc} words</span>
        ${wc < 250 ? ' <span class="wc-hint">(target: 250-300)</span>' : ''}
        ${wc > 300 ? ' <span class="wc-hint">(target: 250-300)</span>' : ''}
      </div>
      <button data-action="verify-hooks" class="verify-btn">Verify Hooks</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// extractCoverLetterModel
// ---------------------------------------------------------------------------

/**
 * Extract the current cover letter model selection from the toggle DOM.
 */
export function extractCoverLetterModel(
  toggles: Map<string, Element>,
): string {
  const featureEl = toggles.get('coverLetter');
  if (!featureEl) return 'claude-haiku-4-5-20251001';

  const select = featureEl.querySelector<HTMLSelectElement>('select[data-role="model"]');
  if (select && select.value) return select.value;

  return 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
