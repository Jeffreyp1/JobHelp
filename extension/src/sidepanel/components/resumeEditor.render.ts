import type {
  ParsedBullet,
  ParsedNode,
  ParsedRole,
  ParsedSection,
} from './resumeEditor.parser.js';

export interface BulletRenderCtx {
  onCommit: (bulletId: string, newText: string) => void;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineHtml(s: string): string {
  return escapeText(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
}

function hasSelectionInside(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return false;
  return Boolean(
    selection.anchorNode &&
      selection.focusNode &&
      el.contains(selection.anchorNode) &&
      el.contains(selection.focusNode),
  );
}

export function makeReviseButton(
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

function renderBullet(b: ParsedBullet, ctx: BulletRenderCtx): HTMLLIElement {
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

  span.addEventListener('click', () => {
    if (hasSelectionInside(span)) return;
    const ta = document.createElement('textarea');
    ta.className = 'resume-bullet__editor';
    ta.value = b.text;
    ta.rows = Math.max(2, Math.ceil(b.text.length / 60));
    li.replaceChild(ta, span);
    ta.focus();
    ta.select();

    let done = false;
    const commit = (): void => {
      if (done) return;
      done = true;
      ctx.onCommit(b.bulletId, ta.value);
    };
    const abort = (): void => {
      if (done) return;
      done = true;
      ctx.onCommit(b.bulletId, b.text);
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        abort();
      }
    });
  });

  return li;
}

function renderRole(r: ParsedRole, ctx: BulletRenderCtx): HTMLElement {
  const art = document.createElement('article');
  art.className = 'resume-role';
  art.setAttribute('data-role-company', r.companyName);

  const head = document.createElement('div');
  head.className = 'resume-role__head';
  const h = document.createElement('h4');
  h.className = 'resume-role__heading';
  h.innerHTML = inlineHtml(r.rawHeading);
  head.appendChild(h);
  art.appendChild(head);

  let currentList: HTMLUListElement | null = null;
  for (const child of r.children) {
    if (child.kind === 'bullet') {
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'resume-bullets';
        art.appendChild(currentList);
      }
      currentList.appendChild(renderBullet(child, ctx));
    } else if (child.kind === 'text') {
      currentList = null;
      const p = document.createElement('p');
      p.className = 'resume-text';
      p.innerHTML = inlineHtml(child.text);
      art.appendChild(p);
    }
  }
  return art;
}

function renderSection(s: ParsedSection, ctx: BulletRenderCtx): HTMLElement {
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
      sec.appendChild(renderRole(child, ctx));
    } else if (child.kind === 'bullet') {
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'resume-bullets';
        sec.appendChild(currentList);
      }
      currentList.appendChild(renderBullet(child, ctx));
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

export function renderParsedInto(container: HTMLElement, nodes: ParsedNode[], ctx: BulletRenderCtx): void {
  container.replaceChildren();
  for (const node of nodes) {
    if (node.kind === 'section') container.appendChild(renderSection(node, ctx));
    else if (node.kind === 'role') container.appendChild(renderRole(node, ctx));
    else if (node.kind === 'bullet') {
      const ul = document.createElement('ul');
      ul.className = 'resume-bullets';
      ul.appendChild(renderBullet(node, ctx));
      container.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.className = 'resume-text';
      p.innerHTML = inlineHtml(node.text);
      container.appendChild(p);
    }
  }
}
