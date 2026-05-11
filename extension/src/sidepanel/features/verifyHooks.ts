/**
 * @file sidepanel/features/verifyHooks.ts
 *
 * Feature: Verify Cover Letter Hooks UI
 * Owner agent: E3 — Cover Letter + Verify CL Hooks
 * Plan section: Phase 1 › Group E3
 *
 * This module wires the "Verify Hooks" button and result overlay.
 * Verify Hooks is not an auto-toggle — it is a manual "Verify" button that
 * appears AFTER the cover letter has been generated.
 *
 * UI flow:
 *   1. "Verify Hooks" button visible after cover letter generates
 *   2. User clicks → calls hooks.onVerifyRequest(coverLetterMd, model)
 *   3. Loading spinner appears
 *   4. Result arrives → show HookVerification[] in a list:
 *      - Green checkmark for "verified"
 *      - Red warning for "unverified" (with reason)
 *      - Yellow question mark for "uncertain"
 *   5. If any unverified: show "⚠ N unverified entities found" banner
 *   6. Updated markdown (with [⚠ UNVERIFIED] tags) shown in preview area
 */

import type {
  VerifyClHooksRequest,
  VerifyClHooksResponse,
  HookVerification,
  HookStatus,
} from '../../types/api-contract.js';

export type { VerifyClHooksRequest, VerifyClHooksResponse, HookVerification, HookStatus };

// ---------------------------------------------------------------------------
// wireVerifyHooksToggle
// ---------------------------------------------------------------------------

/**
 * Wire the Verify Hooks button and result overlay.
 *
 *   1. Find "Verify Hooks" button (hidden until CL result arrives)
 *   2. Register click listener → call hooks.onVerifyRequest(state.coverLetterMd, model)
 *   3. Show loading spinner while waiting
 *   4. On result: render HookVerification[] list with status icons
 *   5. Show unverified count banner if > 0
 *   6. Render updated markdown with [⚠ UNVERIFIED] tags in preview area
 */
export function wireVerifyHooksToggle(
  panelRoot: Element,
  hooks: {
    onVerifyRequest: (coverLetterMd: string, model: string) => void;
    onVerifyResult?: (result: VerifyClHooksResponse) => void;
  },
  state: { verifyHooksModel: string; coverLetterMd: string },
): void {
  // ── 1. Find the Verify Hooks button ─────────────────────────────────────
  const verifyBtn = panelRoot.querySelector<HTMLButtonElement>(
    '[data-action="verify-hooks"]',
  );
  if (!verifyBtn) return;

  // ── 2. Register click listener ───────────────────────────────────────────
  verifyBtn.addEventListener('click', () => {
    if (!state.coverLetterMd) {
      console.warn('[verifyHooks UI] No cover letter text available to verify');
      return;
    }

    // ── 3. Show loading spinner ──────────────────────────────────────────
    _showVerifyLoading(panelRoot);

    hooks.onVerifyRequest(state.coverLetterMd, state.verifyHooksModel);
  });

  // ── 4. Wire result handler ───────────────────────────────────────────────
  if (hooks.onVerifyResult) {
    const originalCallback = hooks.onVerifyResult;
    hooks.onVerifyResult = (result: VerifyClHooksResponse) => {
      _renderVerifyResult(panelRoot, result);
      originalCallback(result);
    };
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<HookStatus, string> = {
  verified: '✓',
  unverified: '⚠',
  uncertain: '?',
};

const STATUS_CLASSES: Record<HookStatus, string> = {
  verified: 'status-verified',
  unverified: 'status-unverified',
  uncertain: 'status-uncertain',
};

function _showVerifyLoading(panelRoot: Element): void {
  const container = panelRoot.querySelector('[data-role="verify-result"]');
  if (!container) return;
  container.innerHTML = '<div class="verify-loading">Verifying entities...</div>';
}

function _renderVerifyResult(panelRoot: Element, result: VerifyClHooksResponse): void {
  const container = panelRoot.querySelector('[data-role="verify-result"]');
  if (!container) return;

  if (!result.ok) {
    container.innerHTML = `
      <div class="verify-error">
        <span>⚠ Verification failed: ${escapeHtml(result.error.message)}</span>
        ${result.error.retryable ? '<button data-action="verify-retry">Retry</button>' : ''}
      </div>
    `;
    return;
  }

  const { verifications, unverifiedCount } = result;

  // ── 5. Unverified count banner ───────────────────────────────────────────
  const bannerHtml = unverifiedCount > 0
    ? `<div class="verify-banner warn">⚠ ${unverifiedCount} unverified ${unverifiedCount === 1 ? 'entity' : 'entities'} found</div>`
    : verifications.length > 0
      ? '<div class="verify-banner ok">All entities verified</div>'
      : '<div class="verify-banner ok">No named entities to verify</div>';

  // ── 4. Entity list ───────────────────────────────────────────────────────
  const itemsHtml = verifications.map(v => {
    const icon = STATUS_ICONS[v.status] ?? '?';
    const cls = STATUS_CLASSES[v.status] ?? '';
    const sourcesHtml = v.sources.length > 0
      ? `<ul class="verify-sources">${v.sources.map(s =>
          `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></li>`
        ).join('')}</ul>`
      : '';
    const reasonHtml = v.reason
      ? `<div class="verify-reason">${escapeHtml(v.reason)}</div>`
      : '';

    return `
      <li class="verify-item ${cls}">
        <span class="status-icon">${icon}</span>
        <span class="entity-name">${escapeHtml(v.entity)}</span>
        <span class="entity-type">(${escapeHtml(v.entityType)})</span>
        ${reasonHtml}
        ${sourcesHtml}
      </li>
    `;
  }).join('');

  container.innerHTML = `
    ${bannerHtml}
    ${verifications.length > 0 ? `<ul class="verify-list">${itemsHtml}</ul>` : ''}
    <div class="verify-cost">Cost: $${result.cost.totalUsd.toFixed(4)}</div>
  `;

  // ── 6. Update CL preview with [⚠ UNVERIFIED] tags ─────────────────────
  if (unverifiedCount > 0) {
    _tagUnverifiedInPreview(panelRoot, verifications);
  }
}

/**
 * Find the CL preview area and replace unverified entity text with tagged version.
 */
function _tagUnverifiedInPreview(
  panelRoot: Element,
  verifications: HookVerification[],
): void {
  const preview = panelRoot.querySelector<HTMLElement>('[data-role="cl-preview"]');
  if (!preview) return;

  let text = preview.textContent ?? '';
  for (const v of verifications) {
    if (v.status === 'unverified') {
      // Simple string replacement — handles first occurrence
      text = text.replace(v.entity, `${v.entity} [⚠ UNVERIFIED]`);
    }
  }
  preview.textContent = text;
}

// ---------------------------------------------------------------------------
// extractVerifyHooksModel
// ---------------------------------------------------------------------------

/**
 * Extract the current verify hooks model selection from the toggle DOM.
 */
export function extractVerifyHooksModel(
  toggles: Map<string, Element>,
): string {
  const featureEl = toggles.get('verifyHooks');
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
