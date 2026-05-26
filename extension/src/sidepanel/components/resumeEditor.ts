import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ReviseTargetScope } from '../../types/api-contract.js';
import {
  buildSelectionScope,
  type SelectionReviseScope,
} from '../../lib/resume-selection.js';
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
  lookupBullet,
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

export type ResumeReviseScope = ReviseTargetScope | SelectionReviseScope;

export interface ResumeReviseEventDetail {
  scope: ResumeReviseScope;
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
  if (btn.classList.contains('revise-whole-resume')) {
    return { kind: 'whole-resume' };
  }
  return null;
}

export function renderResumeEditor(props: ResumeEditorProps): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'resume-editor';
  wrap.setAttribute('aria-label', 'Resume editor');

  let currentMarkdown = props.initialMarkdown;
  let currentSelection: SelectionReviseScope | null = null;

  const heading = document.createElement('h3');
  heading.className = 'resume-editor__title';
  heading.textContent = 'Generated resume';
  wrap.appendChild(heading);

  const toolbar = document.createElement('div');
  toolbar.className = 'resume-editor__toolbar';
  const selectionBtn = document.createElement('button');
  selectionBtn.type = 'button';
  selectionBtn.className = 'btn btn-secondary resume-editor__selection-revise';
  selectionBtn.textContent = 'Revise selection';
  selectionBtn.disabled = true;
  toolbar.appendChild(selectionBtn);
  wrap.appendChild(toolbar);

  const editorHost = document.createElement('div');
  editorHost.className = 'resume-editor__codemirror';
  wrap.appendChild(editorHost);

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
  rawTextarea.value = currentMarkdown;

  let view: EditorView;

  const ctx: BulletRenderCtx = {
    onCommit: (bulletId, newText) => {
      setMarkdown(updateBulletLine(currentMarkdown, bulletId, newText));
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

  const updateSelection = (): void => {
    const main = view.state.selection.main;
    currentSelection = buildSelectionScope(currentMarkdown, main.from, main.to);
    selectionBtn.disabled = currentSelection === null;
  };

  const setMarkdown = (md: string): void => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: md },
    });
  };

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: currentMarkdown,
      extensions: [
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            currentMarkdown = update.state.doc.toString();
            rawTextarea.value = currentMarkdown;
            rerender();
          }
          if (update.selectionSet || update.docChanged) updateSelection();
        }),
      ],
    }),
  });

  const emitRevise = (scope: ResumeReviseScope): void => {
    wrap.dispatchEvent(
      new CustomEvent<ResumeReviseEventDetail>('resume:revise', {
        detail: { scope, currentMarkdown },
        bubbles: true,
      }),
    );
  };

  rawTextarea.addEventListener('input', () => {
    setMarkdown(rawTextarea.value);
  });

  selectionBtn.addEventListener('click', () => {
    if (currentSelection) emitRevise(currentSelection);
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
      'button.revise-bullet, button.revise-section, button.revise-whole-resume',
    );
    if (!btn) return;
    const scope = deriveScope(btn);
    if (!scope) return;
    emitRevise(scope);
  });

  wrap.addEventListener('resume:set-markdown', (ev) => {
    const md = (ev as CustomEvent<{ md: string }>).detail?.md;
    if (typeof md !== 'string') return;
    setMarkdown(md);
  });

  wrap.addEventListener('resume:set-selection', (ev) => {
    const detail = (ev as CustomEvent<{ from: unknown; to: unknown }>).detail;
    if (typeof detail?.from !== 'number' || typeof detail.to !== 'number') return;
    view.dispatch({ selection: { anchor: detail.from, head: detail.to } });
    updateSelection();
  });

  return wrap;
}

export function setEditorMarkdown(editor: HTMLElement, md: string): void {
  editor.dispatchEvent(new CustomEvent('resume:set-markdown', { detail: { md } }));
}

export function setEditorSelection(editor: HTMLElement, from: number, to: number): void {
  editor.dispatchEvent(new CustomEvent('resume:set-selection', { detail: { from, to } }));
}
