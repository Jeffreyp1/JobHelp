/** @vitest-environment jsdom */
/**
 * Tests for the resume editor preview-mode revise wiring. Covers:
 *
 *   - Stable bullet IDs across re-renders of identical markdown.
 *   - data-* attribute emission for sections / roles / bullets.
 *   - "Revise" button rendering at every level.
 *   - CustomEvent('resume:revise') dispatch with the correct scope shape
 *     and currentMarkdown payload.
 *   - Edit / Preview toggle preserves textarea contents.
 */
import { describe, it, expect } from 'vitest';
import {
  renderResumeEditor,
  parseResumeMarkdown,
  bulletIdFor,
} from '../../src/sidepanel/components/resumeEditor';
import type { ResumeReviseEventDetail } from '../../src/sidepanel/components/resumeEditor';
import type { ReviseTargetScope } from '../../src/types/api-contract.js';

const SAMPLE_MD = [
  '# Jordan Rivera',
  '',
  '## Experience',
  '',
  '### Senior Software Engineer at Acme Cloud Inc (Mar 2022 - Present)',
  '- Designed and shipped a multi-region message broker handling **1.2M req/sec**.',
  '- Cut onboarding time for new services from **4 days to 6 hours**.',
  '',
  '### Software Engineer at Brightline Analytics (Jul 2019 - Feb 2022)',
  '- Built streaming ETL ingesting **4TB/day**.',
  '',
  '## Skills',
  '- Python, Go, TypeScript',
  '',
].join('\n');

const editorWith = (md: string) =>
  renderResumeEditor({ initialMarkdown: md, onSave: () => {} });

function switchToPreview(root: HTMLElement): void {
  const previewTab = root.querySelector<HTMLButtonElement>(
    '.resume-editor__tab--preview',
  );
  previewTab?.click();
}

describe('bulletIdFor', () => {
  it('is deterministic for the same input', () => {
    const a = bulletIdFor('Built streaming ETL ingesting 4TB/day', 1);
    const b = bulletIdFor('Built streaming ETL ingesting 4TB/day', 1);
    expect(a).toBe(b);
  });

  it('differs across section indexes (identical text in different sections)', () => {
    const a = bulletIdFor('Mentored engineers', 0);
    const b = bulletIdFor('Mentored engineers', 1);
    expect(a).not.toBe(b);
  });

  it('ignores leading/trailing whitespace', () => {
    const a = bulletIdFor('  Designed broker  ', 0);
    const b = bulletIdFor('Designed broker', 0);
    expect(a).toBe(b);
  });

  it('produces a short hex-prefixed id (b-xxxxxxxx)', () => {
    const id = bulletIdFor('anything', 0);
    expect(id).toMatch(/^b-[0-9a-f]{8}$/);
  });
});

describe('parseResumeMarkdown', () => {
  it('captures sections, roles, bullets in order', () => {
    const tree = parseResumeMarkdown(SAMPLE_MD);
    // Top level: Experience section + Skills section
    const sections = tree.filter((n) => n.kind === 'section');
    expect(sections.length).toBe(2);
    expect(sections[0].kind).toBe('section');
    if (sections[0].kind !== 'section') return;
    expect(sections[0].sectionName).toBe('Experience');

    const roles = sections[0].children.filter((c) => c.kind === 'role');
    expect(roles).toHaveLength(2);
    if (roles[0].kind !== 'role') return;
    expect(roles[0].companyName).toBe('Acme Cloud Inc');
    if (roles[1].kind !== 'role') return;
    expect(roles[1].companyName).toBe('Brightline Analytics');
  });

  it('extracts company name from "Role at Company" headings', () => {
    const tree = parseResumeMarkdown('## Experience\n### Engineer at Stripe (2020)\n- did stuff\n');
    const sec = tree[0];
    if (sec.kind !== 'section') throw new Error('expected section');
    const role = sec.children[0];
    if (role.kind !== 'role') throw new Error('expected role');
    expect(role.companyName).toBe('Stripe');
  });
});

describe('renderResumeEditor — preview mode structure', () => {
  it('emits data-section-name on each section', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    const sections = root.querySelectorAll<HTMLElement>('[data-section-name]');
    const names = Array.from(sections).map((s) => s.dataset.sectionName);
    expect(names).toContain('Experience');
    expect(names).toContain('Skills');
  });

  it('emits data-role-company on each role', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    const roles = root.querySelectorAll<HTMLElement>('[data-role-company]');
    const companies = Array.from(roles).map((r) => r.dataset.roleCompany);
    expect(companies).toContain('Acme Cloud Inc');
    expect(companies).toContain('Brightline Analytics');
  });

  it('emits data-bullet-id on each bullet', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    const bullets = root.querySelectorAll<HTMLElement>('li[data-bullet-id]');
    expect(bullets.length).toBeGreaterThanOrEqual(4);
    bullets.forEach((b) => {
      expect(b.dataset.bulletId).toMatch(/^b-[0-9a-f]{8}$/);
    });
  });

  it('produces identical bullet IDs across re-renders of the same markdown', () => {
    const a = editorWith(SAMPLE_MD);
    switchToPreview(a);
    const b = editorWith(SAMPLE_MD);
    switchToPreview(b);
    const ids = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLElement>('li[data-bullet-id]')).map(
        (el) => el.dataset.bulletId,
      );
    expect(ids(a)).toEqual(ids(b));
  });

  it('renders a Revise button next to each bullet, section, and role', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    expect(
      root.querySelectorAll('button.revise-bullet[data-bullet-id]').length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      root.querySelectorAll('button.revise-section[data-section-name]').length,
    ).toBe(2);
    expect(
      root.querySelectorAll('button.revise-role[data-role-company]').length,
    ).toBe(2);
    expect(root.querySelector('button.revise-whole-resume')).not.toBeNull();
  });
});

describe('renderResumeEditor — resume:revise CustomEvent dispatch', () => {
  it('fires resume:revise with scope=bullet and currentMarkdown on bullet button click', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    let captured: ResumeReviseEventDetail | null = null;
    root.addEventListener('resume:revise', (ev) => {
      captured = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
    });
    const btn = root.querySelector<HTMLButtonElement>(
      'button.revise-bullet[data-bullet-id]',
    );
    expect(btn).not.toBeNull();
    btn!.click();
    expect(captured).not.toBeNull();
    const detail = captured as ResumeReviseEventDetail | null;
    expect(detail!.scope.kind).toBe('bullet');
    const s = detail!.scope as Extract<ReviseTargetScope, { kind: 'bullet' }>;
    expect(s.bulletId).toMatch(/^b-[0-9a-f]{8}$/);
    expect(detail!.currentMarkdown).toBe(SAMPLE_MD);
  });

  it('fires resume:revise with scope=section on section button click', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    let captured: ResumeReviseEventDetail | null = null;
    root.addEventListener('resume:revise', (ev) => {
      captured = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
    });
    const btn = root.querySelector<HTMLButtonElement>(
      'button.revise-section[data-section-name="Experience"]',
    );
    expect(btn).not.toBeNull();
    btn!.click();
    const detail = captured as ResumeReviseEventDetail | null;
    expect(detail!.scope).toEqual({ kind: 'section', sectionName: 'Experience' });
  });

  it('fires resume:revise with scope=role on role button click', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    let captured: ResumeReviseEventDetail | null = null;
    root.addEventListener('resume:revise', (ev) => {
      captured = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
    });
    const btn = root.querySelector<HTMLButtonElement>(
      'button.revise-role[data-role-company="Acme Cloud Inc"]',
    );
    expect(btn).not.toBeNull();
    btn!.click();
    const detail = captured as ResumeReviseEventDetail | null;
    expect(detail!.scope).toEqual({ kind: 'role', companyName: 'Acme Cloud Inc' });
  });

  it('fires resume:revise with scope=whole-resume on whole-resume button click', () => {
    const root = editorWith(SAMPLE_MD);
    let captured: ResumeReviseEventDetail | null = null;
    root.addEventListener('resume:revise', (ev) => {
      captured = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
    });
    const btn = root.querySelector<HTMLButtonElement>('button.revise-whole-resume');
    expect(btn).not.toBeNull();
    btn!.click();
    const detail = captured as ResumeReviseEventDetail | null;
    expect(detail!.scope).toEqual({ kind: 'whole-resume' });
    expect(detail!.currentMarkdown).toBe(SAMPLE_MD);
  });

  it('event bubbles to document', () => {
    const root = editorWith(SAMPLE_MD);
    document.body.appendChild(root);
    switchToPreview(root);
    let bubbled = false;
    document.addEventListener(
      'resume:revise',
      () => {
        bubbled = true;
      },
      { once: true },
    );
    const btn = root.querySelector<HTMLButtonElement>(
      'button.revise-bullet[data-bullet-id]',
    );
    btn!.click();
    expect(bubbled).toBe(true);
    document.body.removeChild(root);
  });

  it('uses the live textarea value (not the initial markdown) in detail.currentMarkdown', () => {
    const root = editorWith(SAMPLE_MD);
    const textarea = root.querySelector<HTMLTextAreaElement>('.resume-editor__textarea');
    textarea!.value = SAMPLE_MD + '\n## Added\n- new bullet';
    textarea!.dispatchEvent(new Event('input'));
    switchToPreview(root);
    let captured: ResumeReviseEventDetail | null = null;
    root.addEventListener('resume:revise', (ev) => {
      captured = (ev as CustomEvent<ResumeReviseEventDetail>).detail;
    });
    const btn = root.querySelector<HTMLButtonElement>('button.revise-whole-resume');
    btn!.click();
    const detail = captured as ResumeReviseEventDetail | null;
    expect(detail!.currentMarkdown).toContain('## Added');
  });
});

describe('renderResumeEditor — Edit/Preview toggle', () => {
  it('starts in Edit mode with textarea visible', () => {
    const root = editorWith(SAMPLE_MD);
    const editorPane = root.querySelector<HTMLElement>('.resume-editor__pane--editor');
    const previewPane = root.querySelector<HTMLElement>('.resume-editor__pane--preview');
    expect(editorPane?.hidden).toBe(false);
    expect(previewPane?.hidden).toBe(true);
  });

  it('toggling to Preview hides editor and shows preview', () => {
    const root = editorWith(SAMPLE_MD);
    switchToPreview(root);
    const editorPane = root.querySelector<HTMLElement>('.resume-editor__pane--editor');
    const previewPane = root.querySelector<HTMLElement>('.resume-editor__pane--preview');
    expect(editorPane?.hidden).toBe(true);
    expect(previewPane?.hidden).toBe(false);
  });

  it('toggling back to Edit preserves textarea contents', () => {
    const root = editorWith(SAMPLE_MD);
    const textarea = root.querySelector<HTMLTextAreaElement>('.resume-editor__textarea');
    textarea!.value = 'edited content';
    textarea!.dispatchEvent(new Event('input'));

    switchToPreview(root);
    const editTab = root.querySelector<HTMLButtonElement>('.resume-editor__tab--edit');
    editTab!.click();

    const editorPane = root.querySelector<HTMLElement>('.resume-editor__pane--editor');
    expect(editorPane?.hidden).toBe(false);
    expect(textarea!.value).toBe('edited content');
  });

  it('still fires onSave with current textarea contents', () => {
    let saved = '';
    const root = renderResumeEditor({
      initialMarkdown: SAMPLE_MD,
      onSave: (md) => {
        saved = md;
      },
    });
    const textarea = root.querySelector<HTMLTextAreaElement>('.resume-editor__textarea');
    textarea!.value = 'final draft';
    const saveBtn = root.querySelector<HTMLButtonElement>('.resume-editor__save');
    saveBtn!.click();
    expect(saved).toBe('final draft');
  });
});
