/**
 * Resume editor: single click-to-edit view of the generated resume.
 *
 * The structured render (sections, roles, bullets) is always visible. Clicking
 * a bullet swaps it for an inline textarea; blur or Enter commits, Esc reverts.
 * A collapsible <details> at the bottom exposes the raw markdown for power
 * users. The "Revise" buttons on bullets, sections, and the whole resume each
 * dispatch a bubbling CustomEvent 'resume:revise' on the editor root with
 * detail = { scope, currentMarkdown }.
 */

import type { ReviseTargetScope } from '../../types/api-contract.js';
import {
  parseResumeMarkdown,
  updateBulletLine,
} from './resumeEditor.parser.js';
import {
  makeReviseButton,
  renderParsedInto,
  type BulletRenderCtx,
} from './resumeEditor.render.js';

export {
  bulletIdFor,
  parseResumeMarkdown,
} from './resumeEditor.parser.js';

/** Outcome of a Save & Log round-trip. */
export type ResumeSaveResult =
  | { ok: true; savedAt: number }
  | { ok: false; message: string };

export interface ResumeEditorProps {
  initialMarkdown: string;
  /**
   * Save handler. A returned `Promise` drives the inline save-status UI
   * (Saving… → Saved / error); a synchronous return is treated as
   * fire-and-forget and shows no status.
   */
  onSave: (md: string) => ResumeSaveResult | void | Promise<ResumeSaveResult | void>;
}

/** Detail payload of the 'resume:revise' CustomEvent. */
export interface ResumeReviseEventDetail {
  scope: ReviseTargetScope;
  currentMarkdown: string;
}

function deriveScope(btn: HTMLButtonElement): ReviseTargetScope | null {
  if (btn.classList.contains('revise-bullet')) {
    const bulletId =
      btn.getAttribute('data-bullet-id') ??
      btn.closest<HTMLElement>('[data-bullet-id]')?.dataset.bulletId ??
      '';
    return bulletId ? { kind: 'bullet', bulletId } : null;
  }
  if (btn.classList.contains('revise-section')) {
    const sectionName =
      btn.getAttribute('data-section-name') ??
      btn.closest<HTMLElement>('[data-section-name]')?.dataset.sectionName ??
      '';
    return sectionName ? { kind: 'section', sectionName } : null;
  }
  if (btn.classList.contains('revise-role')) {
    const companyName =
      btn.getAttribute('data-role-company') ??
      btn.closest<HTMLElement>('[data-role-company]')?.dataset.roleCompany ??
      '';
    return companyName ? { kind: 'role', companyName } : null;
  }
  if (btn.classList.contains('revise-whole-resume')) {
    return { kind: 'whole-resume' };
  }
  return null;
}

export function renderResumeEditor(props: ResumeEditorProps): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'resume-editor';
  wrap.setAttribute('aria-label', 'Resume editor');

  const heading = document.createElement('h3');
  heading.className = 'resume-editor__title';
  heading.textContent = 'Generated resume';
  wrap.appendChild(heading);

  const preview = document.createElement('div');
  preview.className = 'resume-editor__preview';
  wrap.appendChild(preview);

  const rawDetails = document.createElement('details');
  rawDetails.className = 'resume-editor__raw';
  const rawSummary = document.createElement('summary');
  rawSummary.textContent = '<> raw markdown';
  const rawTextarea = document.createElement('textarea');
  rawTextarea.className = 'resume-editor__raw-textarea';
  rawTextarea.rows = 12;
  rawTextarea.spellcheck = false;
  rawDetails.appendChild(rawSummary);
  rawDetails.appendChild(rawTextarea);
  wrap.appendChild(rawDetails);

  const actions = document.createElement('div');
  actions.className = 'resume-editor__actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary resume-editor__save';
  saveBtn.textContent = 'Save & Log';

  const saveStatus = document.createElement('span');
  saveStatus.className = 'resume-editor__save-status';
  saveStatus.setAttribute('role', 'status');
  saveStatus.setAttribute('aria-live', 'polite');

  actions.appendChild(saveBtn);
  actions.appendChild(saveStatus);

  const wholeBtn = makeReviseButton('Revise whole resume', 'revise-whole-resume', {});
  wholeBtn.classList.remove('revise-btn');
  wholeBtn.classList.add('btn', 'btn-secondary', 'revise-whole-resume');
  actions.appendChild(wholeBtn);

  wrap.appendChild(actions);

  let currentMarkdown = props.initialMarkdown;
  rawTextarea.value = currentMarkdown;

  const ctx: BulletRenderCtx = {
    onCommit: (bulletId, newText) => {
      currentMarkdown = updateBulletLine(currentMarkdown, bulletId, newText);
      rawTextarea.value = currentMarkdown;
      rerender();
    },
  };

  const rerender = (): void => {
    try {
      const parsed = parseResumeMarkdown(currentMarkdown);
      renderParsedInto(preview, parsed, ctx);
    } catch {
      preview.replaceChildren();
      const p = document.createElement('pre');
      p.textContent = currentMarkdown;
      preview.appendChild(p);
    }
  };

  rerender();

  rawTextarea.addEventListener('input', () => {
    currentMarkdown = rawTextarea.value;
    rerender();
  });

  saveBtn.addEventListener('click', () => {
    const result = props.onSave(currentMarkdown);
    if (!(result instanceof Promise)) return;
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving…';
    saveStatus.className = 'resume-editor__save-status is-saving';
    void result
      .then((r) => {
        if (r && r.ok === false) {
          saveStatus.textContent = `Save failed: ${r.message}`;
          saveStatus.className = 'resume-editor__save-status is-error';
        } else {
          const at = r && r.ok ? r.savedAt : Date.now();
          const time = new Date(at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          saveStatus.textContent = `Saved ${time}`;
          saveStatus.className = 'resume-editor__save-status is-saved';
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        saveStatus.textContent = `Save failed: ${message}`;
        saveStatus.className = 'resume-editor__save-status is-error';
      })
      .finally(() => {
        saveBtn.disabled = false;
      });
  });

  wrap.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLButtonElement>(
      'button.revise-bullet, button.revise-section, button.revise-role, button.revise-whole-resume',
    );
    if (!btn) return;
    const scope = deriveScope(btn);
    if (!scope) return;
    const detail: ResumeReviseEventDetail = {
      scope,
      currentMarkdown,
    };
    wrap.dispatchEvent(
      new CustomEvent<ResumeReviseEventDetail>('resume:revise', {
        detail,
        bubbles: true,
      }),
    );
  });

  wrap.addEventListener('resume:set-markdown', (ev) => {
    const md = (ev as CustomEvent<{ md: string }>).detail?.md;
    if (typeof md !== 'string') return;
    currentMarkdown = md;
    rawTextarea.value = md;
    rerender();
  });

  return wrap;
}

export function setEditorMarkdown(editor: HTMLElement, md: string): void {
  editor.dispatchEvent(new CustomEvent('resume:set-markdown', { detail: { md } }));
}
