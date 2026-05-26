/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  renderResumeEditor,
  type ResumeReviseEventDetail,
} from '../../extension/src/sidepanel/components/resumeEditor';

const SAMPLE_MD = [
  '## Experience',
  '',
  '- Built an ingestion layer handling **4TB/day**.',
  '- Cut onboarding from **4 days to 6 hours**.',
  '',
].join('\n');

const selectNodeContents = (node: Node): void => {
  const range = document.createRange();
  range.selectNodeContents(node);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const selectAcross = (start: Node, end: Node): void => {
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.textContent?.length ?? 0);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const editorWith = () =>
  renderResumeEditor({
    initialMarkdown: SAMPLE_MD,
    onSave: () => {},
  });

describe('resume editor rendered preview selection', () => {
  it('renders markdown emphasis and hides the raw CodeMirror surface by default', () => {
    const editor = editorWith();
    const preview = editor.querySelector<HTMLElement>('.resume-editor__preview');
    const hiddenSource = editor.querySelector<HTMLDivElement>('.resume-editor__codemirror');

    expect(preview?.querySelector('strong')?.textContent).toBe('4TB/day');
    expect(preview?.textContent).toContain('4TB/day');
    expect(preview?.textContent).not.toContain('**4TB/day**');
    expect(hiddenSource?.hidden).toBe(true);
    expect(editor.querySelector('.resume-editor__selection-revise')).toBeNull();
  });

  it('targets the whole bullet when only part of rendered bullet text is highlighted', () => {
    const editor = editorWith();
    document.body.appendChild(editor);
    const events: ResumeReviseEventDetail[] = [];
    editor.addEventListener('resume:revise', (ev) => {
      events.push((ev as CustomEvent<ResumeReviseEventDetail>).detail);
    });

    const bullet = editor.querySelector<HTMLLIElement>('li[data-bullet-id]')!;
    const strong = bullet.querySelector<HTMLElement>('strong')!;
    selectNodeContents(strong);
    strong.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(events[0]?.scope).toEqual({
      kind: 'bullet',
      bulletId: bullet.dataset.bulletId,
    });
    expect(events[0]?.currentMarkdown).toBe(SAMPLE_MD);
    document.body.removeChild(editor);
  });

  it('does not emit a revise event for an ambiguous cross-bullet highlight', () => {
    const editor = editorWith();
    document.body.appendChild(editor);
    let calls = 0;
    editor.addEventListener('resume:revise', () => {
      calls += 1;
    });

    const bullets = editor.querySelectorAll<HTMLLIElement>('li[data-bullet-id]');
    const first = bullets[0]?.querySelector<HTMLElement>('.resume-bullet__text')?.firstChild;
    const second = bullets[1]?.querySelector<HTMLElement>('.resume-bullet__text')?.firstChild;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    selectAcross(first!, second!);
    bullets[1]?.querySelector<HTMLElement>('.resume-bullet__text')?.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true }),
    );

    expect(calls).toBe(0);
    document.body.removeChild(editor);
  });
});
