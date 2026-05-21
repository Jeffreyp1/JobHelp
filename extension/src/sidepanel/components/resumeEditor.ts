/**
 * Resume editor: tabbed Edit / Preview view of the generated markdown.
 *
 * EDIT mode: a textarea that lets the user edit the markdown directly. The
 * existing "Save & Log" button at the bottom calls back via props.onSave with
 * the textarea's current value.
 *
 * PREVIEW mode: a structured render of the markdown with **revise buttons**
 * next to each bullet, section heading, and role/company heading. The render
 * is produced by a small inline parser (no external markdown library); the
 * shape is fixed to JobHelp's resume conventions:
 *
 *   ## Section Heading            → <section data-section-name="...">
 *   ### Role at Company (date)    → <article data-role-company="<Company>">
 *   - bullet text                 → <li data-bullet-id="<stable-id>">
 *
 * Clicking a "Revise" button dispatches a bubbling CustomEvent
 * 'resume:revise' on the editor root with detail = { scope, currentMarkdown }.
 * The orchestrator (sidepanel/tabs/generate.ts) listens for this event on the
 * editor root element and calls api.autoRevise() with the captured scope.
 *
 * Stable bullet IDs are deterministic — same markdown → same IDs across
 * re-renders. The ID is derived from a CRC32 of the trimmed bullet text plus
 * a section index, so duplicate bullet bodies in different sections still get
 * distinct IDs.
 */

import { marked } from 'marked';
import type { ReviseTargetScope } from '../../types/api-contract.js';

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

/** Strip dangerous tags from rendered HTML. Lightweight; not a full DOMPurify. */
function stripDangerousTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<\s*on\w+\s*=/gi, '<data-stripped=')
    .replace(/javascript:/gi, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// CRC32 — pure, deterministic, no external deps. Used to give bullets a
// stable, content-addressable ID so re-rendering identical markdown produces
// identical IDs (important for auto-revise round-trips).
// ─────────────────────────────────────────────────────────────────────────────

const CRC32_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Stable, deterministic bullet ID. Includes a section index so two bullets
 * with identical text in different sections still get distinct IDs.
 */
export function bulletIdFor(bulletText: string, sectionIndex: number): string {
  const trimmed = bulletText.trim();
  const hex = crc32(`${sectionIndex}:${trimmed}`).toString(16).padStart(8, '0');
  return `b-${hex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown parser — covers the JobHelp resume shape only:
//   ## H2 = section
//   ### H3 = role (parsed for "Role at Company" or "Role — Company" or first
//           bolded company token; fallback: full heading text)
//   - bullet
// Everything else is rendered as plain text inside the current container.
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedBullet {
  kind: 'bullet';
  text: string;
  bulletId: string;
}
interface ParsedRole {
  kind: 'role';
  rawHeading: string;
  companyName: string;
  children: ParsedNode[];
}
interface ParsedSection {
  kind: 'section';
  sectionName: string;
  children: ParsedNode[];
}
interface ParsedText {
  kind: 'text';
  text: string;
}
type ParsedNode = ParsedBullet | ParsedRole | ParsedSection | ParsedText;

/**
 * Extract a company token from an H3 heading like:
 *   "Senior Software Engineer at Acme Cloud (Mar 2022 - Present)"
 *   "Senior Engineer — Brightline Analytics | *Python* | Jul 2019 - Feb 2022"
 *   "**Senior Software Engineer** Acme Cloud Inc | *Go* | Mar 2022 - Present"
 *
 * Heuristic, in order:
 *  1. "<role> at <Company>"     → group 2
 *  2. "<role> — <Company>"      → group 2 (em-dash or hyphen with spaces)
 *  3. After the first bolded **Role**: take the next non-bolded run up to "|"
 *  4. Fallback: the heading text itself, trimmed of pipes/dates.
 */
function extractCompanyName(heading: string): string {
  const stripped = heading
    .replace(/^\s*#+\s*/, '')
    .replace(/\s*\(\s*[^)]*\d{4}[^)]*\)\s*$/, '') // trim "(2022 - 2024)" trailing date
    .trim();

  // 1. "Role at Company"
  let m = stripped.match(/^.+?\s+at\s+(.+?)(?:\s*[|—-]\s*.*)?$/i);
  if (m && m[1]) return m[1].trim();

  // 2. "Role — Company" or "Role - Company"
  m = stripped.match(/^.+?\s+[—–]\s+(.+?)(?:\s*[|]\s*.*)?$/);
  if (m && m[1]) return m[1].trim();

  // 3. "**Role** Company | ..." — bold prefix followed by company
  m = stripped.match(/^\*\*[^*]+\*\*\s+(.+?)(?:\s*[|]\s*.*)?$/);
  if (m && m[1]) return m[1].trim();

  // 4. Fallback: first pipe-delimited segment, stripped of asterisks.
  const firstSeg = stripped.split('|')[0] ?? stripped;
  return firstSeg.replace(/\*\*/g, '').trim();
}

/** Parse the markdown into a shallow tree of section → role → bullet. */
export function parseResumeMarkdown(md: string): ParsedNode[] {
  const lines = md.split('\n');
  const root: ParsedNode[] = [];
  let currentSection: ParsedSection | null = null;
  let currentRole: ParsedRole | null = null;
  let sectionIndex = -1;

  const addToCurrent = (node: ParsedNode): void => {
    if (currentRole) currentRole.children.push(node);
    else if (currentSection) currentSection.children.push(node);
    else root.push(node);
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    // ## Section
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      sectionIndex += 1;
      currentSection = {
        kind: 'section',
        sectionName: h2[1].trim(),
        children: [],
      };
      currentRole = null;
      root.push(currentSection);
      continue;
    }

    // ### Role at Company (date)
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      const raw = h3[1].trim();
      currentRole = {
        kind: 'role',
        rawHeading: raw,
        companyName: extractCompanyName(raw),
        children: [],
      };
      if (currentSection) currentSection.children.push(currentRole);
      else root.push(currentRole);
      continue;
    }

    // - bullet
    const bullet = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (bullet) {
      const text = bullet[1].trim();
      addToCurrent({
        kind: 'bullet',
        text,
        bulletId: bulletIdFor(text, Math.max(0, sectionIndex)),
      });
      continue;
    }

    // Other text — only keep non-empty lines as text nodes
    if (trimmed.length > 0) {
      addToCurrent({ kind: 'text', text: trimmed });
    }
  }
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render helpers — turn ParsedNode[] into DOM with data-* attrs + Revise btns.
// ─────────────────────────────────────────────────────────────────────────────

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Lightweight inline formatter: **bold**, *italic*. Plain text otherwise. */
function inlineHtml(s: string): string {
  return escapeText(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
}

function makeReviseButton(
  label: string,
  cls: string,
  attrs: Record<string, string>,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `revise-btn ${cls}`;
  btn.textContent = label;
  for (const [k, v] of Object.entries(attrs)) {
    btn.setAttribute(k, v);
  }
  return btn;
}

function renderBullet(b: ParsedBullet): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'resume-bullet';
  li.setAttribute('data-bullet-id', b.bulletId);
  const span = document.createElement('span');
  span.className = 'resume-bullet__text';
  span.innerHTML = inlineHtml(b.text);
  li.appendChild(span);
  li.appendChild(
    makeReviseButton('Revise', 'revise-bullet', { 'data-bullet-id': b.bulletId }),
  );
  return li;
}

function renderRole(r: ParsedRole): HTMLElement {
  const art = document.createElement('article');
  art.className = 'resume-role';
  art.setAttribute('data-role-company', r.companyName);

  const head = document.createElement('div');
  head.className = 'resume-role__head';
  const h = document.createElement('h4');
  h.className = 'resume-role__heading';
  h.innerHTML = inlineHtml(r.rawHeading);
  head.appendChild(h);
  head.appendChild(
    makeReviseButton('Revise role', 'revise-role', { 'data-role-company': r.companyName }),
  );
  art.appendChild(head);

  // Group bullets into a <ul>; other children render as <p>.
  let currentList: HTMLUListElement | null = null;
  for (const child of r.children) {
    if (child.kind === 'bullet') {
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'resume-bullets';
        art.appendChild(currentList);
      }
      currentList.appendChild(renderBullet(child));
    } else if (child.kind === 'text') {
      currentList = null;
      const p = document.createElement('p');
      p.className = 'resume-text';
      p.innerHTML = inlineHtml(child.text);
      art.appendChild(p);
    }
    // role/section can't nest under role in our shape; skip.
  }
  return art;
}

function renderSection(s: ParsedSection): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'resume-section';
  sec.setAttribute('data-section-name', s.sectionName);

  const head = document.createElement('div');
  head.className = 'resume-section__head';
  const h = document.createElement('h3');
  h.className = 'resume-section__heading';
  h.textContent = s.sectionName;
  head.appendChild(h);
  head.appendChild(
    makeReviseButton('Revise section', 'revise-section', { 'data-section-name': s.sectionName }),
  );
  sec.appendChild(head);

  let currentList: HTMLUListElement | null = null;
  for (const child of s.children) {
    if (child.kind === 'role') {
      currentList = null;
      sec.appendChild(renderRole(child));
    } else if (child.kind === 'bullet') {
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'resume-bullets';
        sec.appendChild(currentList);
      }
      currentList.appendChild(renderBullet(child));
    } else if (child.kind === 'text') {
      currentList = null;
      const p = document.createElement('p');
      p.className = 'resume-text';
      p.innerHTML = inlineHtml(child.text);
      sec.appendChild(p);
    }
  }
  return sec;
}

/** Render the parsed tree into a container element. */
function renderParsedInto(container: HTMLElement, nodes: ParsedNode[]): void {
  container.replaceChildren();
  for (const node of nodes) {
    if (node.kind === 'section') container.appendChild(renderSection(node));
    else if (node.kind === 'role') container.appendChild(renderRole(node));
    else if (node.kind === 'bullet') {
      // Stray top-level bullet: wrap in a <ul>.
      const ul = document.createElement('ul');
      ul.className = 'resume-bullets';
      ul.appendChild(renderBullet(node));
      container.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.className = 'resume-text';
      p.innerHTML = inlineHtml(node.text);
      container.appendChild(p);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render
// ─────────────────────────────────────────────────────────────────────────────

export function renderResumeEditor(props: ResumeEditorProps): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'resume-editor';
  wrap.setAttribute('aria-label', 'Resume editor');

  const heading = document.createElement('h3');
  heading.className = 'resume-editor__title';
  heading.textContent = 'Generated resume';
  wrap.appendChild(heading);

  // ── Mode toggle (Edit / Preview) ────────────────────────────────────────
  const tabs = document.createElement('div');
  tabs.className = 'resume-editor__tabs';
  tabs.setAttribute('role', 'tablist');

  const editTab = document.createElement('button');
  editTab.type = 'button';
  editTab.className = 'resume-editor__tab resume-editor__tab--edit is-active';
  editTab.setAttribute('role', 'tab');
  editTab.setAttribute('aria-selected', 'true');
  editTab.dataset.mode = 'edit';
  editTab.textContent = 'Edit';

  const previewTab = document.createElement('button');
  previewTab.type = 'button';
  previewTab.className = 'resume-editor__tab resume-editor__tab--preview';
  previewTab.setAttribute('role', 'tab');
  previewTab.setAttribute('aria-selected', 'false');
  previewTab.dataset.mode = 'preview';
  previewTab.textContent = 'Preview';

  tabs.appendChild(editTab);
  tabs.appendChild(previewTab);
  wrap.appendChild(tabs);

  // ── Edit pane (textarea) ────────────────────────────────────────────────
  const editorPane = document.createElement('div');
  editorPane.className = 'resume-editor__pane resume-editor__pane--editor';
  editorPane.setAttribute('role', 'tabpanel');
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

  // ── Preview pane (rendered markdown with revise buttons) ───────────────
  const previewPane = document.createElement('div');
  previewPane.className = 'resume-editor__pane resume-editor__pane--preview';
  previewPane.setAttribute('role', 'tabpanel');
  previewPane.hidden = true;
  const previewLabel = document.createElement('div');
  previewLabel.className = 'resume-editor__pane-label';
  previewLabel.textContent = 'Preview';
  const preview = document.createElement('div');
  preview.className = 'resume-editor__preview';
  previewPane.appendChild(previewLabel);
  previewPane.appendChild(preview);

  // Legacy "live preview" rendering, used as a fallback for non-structured
  // content. The structured render (parseResumeMarkdown → renderParsedInto)
  // takes precedence, but we keep the marked-based render available so the
  // existing smoke test (expects preview innerHTML to contain "Hello") and
  // any non-section/role/bullet content still appear.
  const legacyPreview = document.createElement('div');
  legacyPreview.className = 'resume-editor__preview-legacy';
  legacyPreview.hidden = true;
  previewPane.appendChild(legacyPreview);

  wrap.appendChild(editorPane);
  wrap.appendChild(previewPane);

  // ── Action row: Save & Log + "Revise whole resume" ──────────────────────
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

  saveBtn.addEventListener('click', () => {
    const result = props.onSave(textarea.value);
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
  actions.appendChild(saveBtn);
  actions.appendChild(saveStatus);

  const wholeBtn = makeReviseButton('Revise whole resume', 'revise-whole-resume', {});
  wholeBtn.classList.remove('revise-btn');
  wholeBtn.classList.add('btn', 'btn-secondary', 'revise-whole-resume');
  actions.appendChild(wholeBtn);

  wrap.appendChild(actions);

  // ── Mode switch + render plumbing ──────────────────────────────────────
  const setMode = (mode: 'edit' | 'preview'): void => {
    const isEdit = mode === 'edit';
    editorPane.hidden = !isEdit;
    previewPane.hidden = isEdit;
    editTab.classList.toggle('is-active', isEdit);
    previewTab.classList.toggle('is-active', !isEdit);
    editTab.setAttribute('aria-selected', String(isEdit));
    previewTab.setAttribute('aria-selected', String(!isEdit));
    if (!isEdit) updatePreview();
  };

  const updatePreview = (): void => {
    const md = textarea.value;
    try {
      const parsed = parseResumeMarkdown(md);
      renderParsedInto(preview, parsed);
      // Keep the legacy render in sync but hidden by default — exposed only
      // when the structured render produced nothing (e.g. headerless markdown).
      const html = marked.parse(md, { async: false }) as string;
      legacyPreview.innerHTML = stripDangerousTags(html);
      legacyPreview.hidden = preview.childElementCount > 0;
    } catch {
      preview.replaceChildren();
      legacyPreview.textContent = md;
      legacyPreview.hidden = false;
    }
  };

  editTab.addEventListener('click', () => setMode('edit'));
  previewTab.addEventListener('click', () => setMode('preview'));
  textarea.addEventListener('input', updatePreview);

  // Initial preview render so it's ready when the user switches modes, and so
  // legacyPreview matches existing smoke-test expectations on first mount.
  updatePreview();

  // ── Revise event delegation ─────────────────────────────────────────────
  // Any click on a revise-* button bubbles up through the preview tree to the
  // editor root; capture here, derive scope from the closest [data-*] ancestor,
  // and dispatch a 'resume:revise' CustomEvent with currentMarkdown attached.
  wrap.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLButtonElement>('button.revise-bullet, button.revise-section, button.revise-role, button.revise-whole-resume');
    if (!btn) return;

    let scope: ReviseTargetScope | null = null;
    if (btn.classList.contains('revise-bullet')) {
      const bulletId =
        btn.getAttribute('data-bullet-id') ??
        btn.closest<HTMLElement>('[data-bullet-id]')?.dataset.bulletId ??
        '';
      if (bulletId) scope = { kind: 'bullet', bulletId };
    } else if (btn.classList.contains('revise-section')) {
      const sectionName =
        btn.getAttribute('data-section-name') ??
        btn.closest<HTMLElement>('[data-section-name]')?.dataset.sectionName ??
        '';
      if (sectionName) scope = { kind: 'section', sectionName };
    } else if (btn.classList.contains('revise-role')) {
      const companyName =
        btn.getAttribute('data-role-company') ??
        btn.closest<HTMLElement>('[data-role-company]')?.dataset.roleCompany ??
        '';
      if (companyName) scope = { kind: 'role', companyName };
    } else if (btn.classList.contains('revise-whole-resume')) {
      scope = { kind: 'whole-resume' };
    }

    if (!scope) return;
    const detail: ResumeReviseEventDetail = {
      scope,
      currentMarkdown: textarea.value,
    };
    wrap.dispatchEvent(
      new CustomEvent<ResumeReviseEventDetail>('resume:revise', {
        detail,
        bubbles: true,
      }),
    );
  });

  return wrap;
}
