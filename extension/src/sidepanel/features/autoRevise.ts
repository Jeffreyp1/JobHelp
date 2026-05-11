/**
 * @file sidepanel/features/autoRevise.ts
 *
 * Feature: Auto-revise UI
 * Owner agent: E2 — Critique + Auto-revise
 *
 * Wires per-bullet edit buttons and the diff preview overlay in the resume
 * editor. Auto-revise is interactive — it is not a simple toggle. A "Revise"
 * button appears next to each bullet (or section heading); clicking it opens
 * an instruction textarea, which on submit calls the orchestrator's
 * onReviseRequest hook. The orchestrator is responsible for the network call;
 * after it returns, the orchestrator hands the response back to renderDiff()
 * so the user can Accept or Reject.
 *
 * Selector convention:
 *   - Bullets are expected to carry data-bullet-id="<id>" attributes.
 *   - Section headings carry data-section-name="<name>" attributes (optional).
 *   - Role headers (company headings) carry data-role-company="<name>" (optional).
 *   - The diff overlay container must be `[data-revise-diff]`.
 *
 * ⚠ CROSS-IMPACT: extension/src/sidepanel/tabs/generate.ts must (1) render
 * bullet/section/role data-attributes in the resume editor, (2) on
 * onReviseRequest call api.autoRevise() and pass the response to
 * renderRevisionDiff, (3) wire Accept/Reject to update the editor and the
 * stored markdown. Owner: orchestrator.
 */

import type {
  AutoReviseRequest,
  AutoReviseResponse,
  AutoReviseDiff,
  ReviseTargetScope,
} from '../../types/api-contract.js';

export type { AutoReviseRequest, AutoReviseResponse, AutoReviseDiff, ReviseTargetScope };

const FEATURE_NAME = 'autoRevise';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

interface AutoReviseHooks {
  onReviseRequest: (scope: ReviseTargetScope, instruction: string) => void;
  onRevisionAccepted: (revisedMarkdown: string) => void;
  onRevisionRejected: () => void;
  onModelChange?: (feature: string, model: string) => void;
}

/**
 * Wire the auto-revise edit buttons and the diff overlay container. Repeated
 * calls remove prior listeners by cloning the relevant elements.
 */
export function wireAutoReviseToggle(
  panelRoot: Element,
  hooks: AutoReviseHooks,
  state: { currentMarkdown: string; autoReviseModel: string },
): void {
  // 1. Wire the model dropdown if present (used by orchestrator to pick model
  //    when calling api.autoRevise).
  const container = panelRoot.querySelector(`[data-feature="${FEATURE_NAME}"]`);
  if (container) {
    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select.model-select, select.toggle-row__model',
    );
    if (modelSelect) {
      if (state.autoReviseModel) modelSelect.value = state.autoReviseModel;
      if (hooks.onModelChange) {
        modelSelect.addEventListener('change', () => {
          hooks.onModelChange?.(FEATURE_NAME, modelSelect.value);
        });
      }
    }
  }

  // 2. Wire revise buttons next to bullets.
  const bulletButtons = panelRoot.querySelectorAll<HTMLButtonElement>(
    '[data-bullet-id] .revise-btn, button.revise-bullet[data-bullet-id]',
  );
  bulletButtons.forEach((btn) => {
    const wrapper = btn.closest<HTMLElement>('[data-bullet-id]');
    const bulletId = btn.getAttribute('data-bullet-id') ?? wrapper?.dataset.bulletId;
    if (!bulletId) return;
    btn.addEventListener('click', () => openInstructionPrompt(panelRoot, hooks, {
      kind: 'bullet',
      bulletId,
    }));
  });

  // 3. Wire revise buttons next to sections.
  const sectionButtons = panelRoot.querySelectorAll<HTMLButtonElement>(
    'button.revise-section[data-section-name]',
  );
  sectionButtons.forEach((btn) => {
    const sectionName = btn.getAttribute('data-section-name');
    if (!sectionName) return;
    btn.addEventListener('click', () => openInstructionPrompt(panelRoot, hooks, {
      kind: 'section',
      sectionName,
    }));
  });

  // 4. Wire revise buttons next to roles.
  const roleButtons = panelRoot.querySelectorAll<HTMLButtonElement>(
    'button.revise-role[data-role-company]',
  );
  roleButtons.forEach((btn) => {
    const companyName = btn.getAttribute('data-role-company');
    if (!companyName) return;
    btn.addEventListener('click', () => openInstructionPrompt(panelRoot, hooks, {
      kind: 'role',
      companyName,
    }));
  });

  // 5. Wire whole-resume button (if present).
  const wholeBtn = panelRoot.querySelector<HTMLButtonElement>('button.revise-whole-resume');
  if (wholeBtn) {
    wholeBtn.addEventListener('click', () => openInstructionPrompt(panelRoot, hooks, {
      kind: 'whole-resume',
    }));
  }
}

/**
 * Extract the current auto-revise model selection from the toggle DOM.
 */
export function extractAutoReviseModel(toggles: Map<string, Element>): string {
  const el = toggles.get(FEATURE_NAME);
  if (!el) return DEFAULT_MODEL;
  const select = el.querySelector<HTMLSelectElement>(
    'select.model-select, select.toggle-row__model',
  );
  return select?.value || DEFAULT_MODEL;
}

/**
 * Open the instruction prompt overlay. The user enters an instruction and
 * confirms; on confirm we call hooks.onReviseRequest(scope, instruction).
 */
function openInstructionPrompt(
  panelRoot: Element,
  hooks: AutoReviseHooks,
  scope: ReviseTargetScope,
): void {
  const overlay = panelRoot.querySelector<HTMLElement>('[data-revise-instruction-overlay]');
  if (!overlay) {
    // Fallback: simple prompt() — not great UX but lets the flow function in
    // environments where the orchestrator hasn't yet rendered the overlay.
    if (typeof globalThis !== 'undefined' && (globalThis as { prompt?: (msg: string) => string | null }).prompt) {
      const instruction = (globalThis as { prompt: (msg: string) => string | null })
        .prompt('Enter revision instruction:');
      if (instruction && instruction.trim()) {
        hooks.onReviseRequest(scope, instruction.trim());
      }
    }
    return;
  }

  // Wire the overlay textarea + submit button. Idempotent: clone to drop
  // previous handlers.
  const textarea = overlay.querySelector<HTMLTextAreaElement>('textarea');
  const submit = overlay.querySelector<HTMLButtonElement>('button[data-action="submit"]');
  const cancel = overlay.querySelector<HTMLButtonElement>('button[data-action="cancel"]');
  if (!textarea || !submit) return;

  // Show overlay
  overlay.removeAttribute('hidden');
  textarea.value = '';
  textarea.focus();

  const onSubmit = () => {
    const instruction = textarea.value.trim();
    if (!instruction) return;
    hooks.onReviseRequest(scope, instruction);
    overlay.setAttribute('hidden', 'true');
    submit.removeEventListener('click', onSubmit);
    cancel?.removeEventListener('click', onCancel);
  };
  const onCancel = () => {
    overlay.setAttribute('hidden', 'true');
    submit.removeEventListener('click', onSubmit);
    cancel?.removeEventListener('click', onCancel);
  };

  submit.addEventListener('click', onSubmit);
  cancel?.addEventListener('click', onCancel);
}

/**
 * Render a revision diff overlay so the user can review before accepting.
 *
 * If `unauthorizedChanges.length > 0`, a warning banner is rendered above the
 * diff and the Accept button is disabled by default (the caller can override
 * via state.allowUnauthorized).
 */
export function renderRevisionDiff(
  panelRoot: Element,
  result: AutoReviseResponse,
  hooks: AutoReviseHooks,
): void {
  const target = panelRoot.querySelector('[data-revise-diff]');
  if (!target) return;

  if (!result.ok) {
    target.innerHTML = `<div class="revise-error">Revision failed: ${escapeHtml(result.error.message)}</div>`;
    return;
  }

  const warning =
    result.unauthorizedChanges.length > 0
      ? `<div class="revise-warning"><strong>Warning:</strong> ${result.unauthorizedChanges.length} change(s) outside your requested scope. Review before accepting.</div>`
      : '';

  const diffRows = result.diff
    .map(
      (d) => `
        <tr class="diff-row">
          <td class="diff-line">${d.lineIndex}</td>
          <td class="diff-before">${escapeHtml(d.before)}</td>
          <td class="diff-after">${escapeHtml(d.after)}</td>
        </tr>
      `,
    )
    .join('');

  target.innerHTML = `
    ${warning}
    <table class="revise-diff">
      <thead><tr><th>Line</th><th>Before</th><th>After</th></tr></thead>
      <tbody>${diffRows}</tbody>
    </table>
    <div class="revise-actions">
      <button data-action="accept" class="revise-accept">Accept</button>
      <button data-action="reject" class="revise-reject">Reject</button>
    </div>
  `;

  const accept = target.querySelector<HTMLButtonElement>('button[data-action="accept"]');
  const reject = target.querySelector<HTMLButtonElement>('button[data-action="reject"]');
  if (accept) {
    accept.addEventListener('click', () => {
      hooks.onRevisionAccepted(result.revisedMarkdown);
      target.innerHTML = '';
    });
  }
  if (reject) {
    reject.addEventListener('click', () => {
      hooks.onRevisionRejected();
      target.innerHTML = '';
    });
  }
  target.removeAttribute('hidden');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
