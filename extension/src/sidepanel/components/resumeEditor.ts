/**
 * Resume editor: split view with a markdown textarea on the left/top and a
 * live-rendered preview on the right/bottom. The "Save & Log" button calls
 * back via onSave with the current textarea contents.
 *
 * Markdown is rendered via the `marked` library. We sanitize the rendered
 * output by stripping any <script> / <iframe> tags before insertion to avoid
 * injecting hostile content from a model response.
 */

import { marked } from 'marked';

export interface ResumeEditorProps {
  initialMarkdown: string;
  onSave: (md: string) => void;
}

/** Strip dangerous tags from rendered HTML. Lightweight; not a full DOMPurify. */
function stripDangerousTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<\s*on\w+\s*=/gi, '<data-stripped=')
    .replace(/javascript:/gi, '');
}

export function renderResumeEditor(props: ResumeEditorProps): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'resume-editor';
  wrap.setAttribute('aria-label', 'Resume editor');

  const heading = document.createElement('h3');
  heading.className = 'resume-editor__title';
  heading.textContent = 'Generated resume';
  wrap.appendChild(heading);

  const split = document.createElement('div');
  split.className = 'resume-editor__split';

  // Editor pane
  const editorPane = document.createElement('div');
  editorPane.className = 'resume-editor__pane resume-editor__pane--editor';
  const editorLabel = document.createElement('div');
  editorLabel.className = 'resume-editor__pane-label';
  editorLabel.textContent = 'Markdown';
  const textarea = document.createElement('textarea');
  textarea.className = 'resume-editor__textarea';
  textarea.value = props.initialMarkdown;
  textarea.spellcheck = false;
  textarea.rows = 18;
  editorPane.appendChild(editorLabel);
  editorPane.appendChild(textarea);

  // Preview pane
  const previewPane = document.createElement('div');
  previewPane.className = 'resume-editor__pane resume-editor__pane--preview';
  const previewLabel = document.createElement('div');
  previewLabel.className = 'resume-editor__pane-label';
  previewLabel.textContent = 'Preview';
  const preview = document.createElement('div');
  preview.className = 'resume-editor__preview';
  previewPane.appendChild(previewLabel);
  previewPane.appendChild(preview);

  split.appendChild(editorPane);
  split.appendChild(previewPane);
  wrap.appendChild(split);

  // Save button row
  const actions = document.createElement('div');
  actions.className = 'resume-editor__actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary resume-editor__save';
  saveBtn.textContent = 'Save & Log';
  saveBtn.addEventListener('click', () => {
    props.onSave(textarea.value);
  });
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  // Live preview update
  const updatePreview = () => {
    const md = textarea.value;
    try {
      const html = marked.parse(md, { async: false }) as string;
      preview.innerHTML = stripDangerousTags(html);
    } catch {
      // Fallback: render as preformatted text on parse error.
      preview.textContent = md;
    }
  };
  textarea.addEventListener('input', updatePreview);
  // Initial render
  updatePreview();

  return wrap;
}
