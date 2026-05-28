/**
 * Files tab — read-only listing of the user's Drive content split into two
 * sections: source materials and rule files. Each row links out to the file
 * in Drive (Drive's editor is the v1 editing surface; we don't edit in panel).
 *
 * The parent provides a fetcher that returns FileSummary[] for each section.
 * "Sync from Drive" re-invokes the fetcher.
 */

import { formatTokens } from '../../lib/tokenFormatter.js';
import type { FileSummary, FolderType } from '../../types/api-contract.js';

export interface FilesTabHooks {
  /** Fetcher that returns the latest file list for one section. */
  fetchFiles: (folder: FolderType) => Promise<FileSummary[]>;
}

export interface FilesTabController {
  root: HTMLElement;
  refresh(): Promise<void>;
}

export function renderFilesTab(hooks: FilesTabHooks): FilesTabController {
  const root = document.createElement('section');
  root.className = 'tab-pane tab-pane--files';

  const sourceSection = renderFolderSection('Source materials', 'source', hooks);
  const rulesSection = renderFolderSection('Rule files', 'rules', hooks);

  root.appendChild(sourceSection.el);
  root.appendChild(rulesSection.el);

  // Global "Sync from Drive" button (re-fetches both)
  const actions = document.createElement('div');
  actions.className = 'files__actions';
  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'btn btn-secondary';
  syncBtn.textContent = 'Sync from Drive';
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      await Promise.all([sourceSection.refresh(), rulesSection.refresh()]);
    } finally {
      syncBtn.disabled = false;
    }
  });
  actions.appendChild(syncBtn);
  root.appendChild(actions);

  async function refresh(): Promise<void> {
    await Promise.all([sourceSection.refresh(), rulesSection.refresh()]);
  }

  // Initial load — best effort.
  void refresh();

  return { root, refresh };
}

function renderFolderSection(
  title: string,
  folder: FolderType,
  hooks: FilesTabHooks,
): { el: HTMLElement; refresh: () => Promise<void> } {
  const section = document.createElement('section');
  section.className = `files-section files-section--${folder}`;
  const heading = document.createElement('h3');
  heading.className = 'files-section__title';
  heading.textContent = title;
  section.appendChild(heading);

  const totalEl = document.createElement('div');
  totalEl.className = 'files-section__total';
  section.appendChild(totalEl);

  const list = document.createElement('ul');
  list.className = 'files-section__list';
  section.appendChild(list);

  const status = document.createElement('div');
  status.className = 'files-section__status';
  section.appendChild(status);

  async function refresh(): Promise<void> {
    status.textContent = 'Loading…';
    list.replaceChildren();
    try {
      const files = await hooks.fetchFiles(folder);
      const totalTokens = files.reduce((acc, f) => acc + (f.tokens ?? 0), 0);
      totalEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'} · ${formatTokens(
        totalTokens,
      )}`;
      if (files.length === 0) {
        status.textContent = 'No files in this folder yet.';
        return;
      }
      status.textContent = '';
      for (const f of files) {
        list.appendChild(renderFileRow(f));
      }
    } catch (err) {
      status.textContent = `Could not load files: ${(err as Error).message ?? err}`;
    }
  }

  return { el: section, refresh };
}

function renderFileRow(f: FileSummary): HTMLElement {
  const li = document.createElement('li');
  li.className = 'files-row';

  const name = document.createElement('span');
  name.className = 'files-row__name';
  name.textContent = f.name;
  li.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'files-row__meta';
  meta.textContent = formatTokens(f.tokens);
  li.appendChild(meta);

  if (f.loadBearing) {
    const lb = document.createElement('span');
    lb.className = 'files-row__badge files-row__badge--load-bearing';
    lb.textContent = 'load-bearing';
    lb.title = 'This file is critical to output quality. Edit with care.';
    li.appendChild(lb);
  }

  const open = document.createElement('a');
  open.className = 'files-row__open btn btn-ghost';
  open.href = f.viewUrl;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open in Drive';
  li.appendChild(open);

  return li;
}
