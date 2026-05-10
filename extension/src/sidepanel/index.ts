/**
 * Side-panel entry point.
 *
 * Wires up:
 *   - Tab navigation across Generate / Files / Settings
 *   - Message bus listener for scrape_result / generate_result events from
 *     the background worker
 *   - The hooks each tab needs (generate request → background, file fetch
 *     → background, etc.)
 *
 * Background and message-bus library are owned by Agent A9 (background.ts +
 * lib/messageBus.ts). This file uses chrome.runtime.sendMessage / onMessage
 * directly with type-narrowed Message payloads.
 */

import { renderGenerateTab, type GenerateTabController } from './tabs/generate.js';
import { renderFilesTab, type FilesTabController } from './tabs/files.js';
import { renderSettingsTab } from './tabs/settings.js';
import { ApiClient } from '../lib/apiClient.js';
import type { Message } from '../types/message-bus.js';
import type { FileSummary, FolderType } from '../types/api-contract.js';
import { get } from '../lib/storage.js';

type TabName = 'generate' | 'files' | 'settings';

interface PanelControllers {
  generate: GenerateTabController;
  files: FilesTabController;
  settingsRoot: HTMLElement;
}

function getChrome(): typeof chrome | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  if (c?.runtime?.sendMessage) return c as typeof chrome;
  return null;
}

function buildControllers(): PanelControllers {
  const generate = renderGenerateTab({
    onGenerate: (req) => {
      const c = getChrome();
      if (!c) {
        console.warn('chrome.runtime not available; generate request not sent.');
        return;
      }
      c.runtime.sendMessage({
        type: 'generate_request',
        payload: { action: 'generate', ...req },
      });
      generate.setBusy(true, 'Generating…');
    },
    onSaveResume: (md) => {
      // v1: save & log is the same trip as generate's downstream — for now we
      // just notify the user that the latest text is captured. The Apps Script
      // call already saved the doc; subsequent edits stay client-side until
      // we add a write_file path.
      console.info('Resume captured:', md.length, 'chars');
    },
    onFinalize: async ({ format, markdown, docId, jobFolderId }) => {
      // Resolve the Apps Script URL from storage, same as background worker.
      let appsScriptUrl: string | null = null;
      try {
        appsScriptUrl = await get('appsScriptUrl');
      } catch {
        // ignore; will fail below
      }
      if (!appsScriptUrl) {
        return { ok: false, message: 'Apps Script URL not configured. Check Settings.' };
      }
      const client = new ApiClient(appsScriptUrl);
      const resp = await client.finalize({
        docId,
        jobFolderId,
        finalMarkdown: markdown,
        formats: [format],
      });
      if (!resp.ok) {
        return { ok: false, message: resp.error.message };
      }
      const file = resp.files[0];
      if (!file) {
        return { ok: false, message: 'Backend returned no files.' };
      }
      return { ok: true, url: file.url, fileName: file.fileName };
    },
  });

  const files = renderFilesTab({
    fetchFiles: async (folder: FolderType): Promise<FileSummary[]> => {
      const folderId =
        folder === 'source'
          ? await get('driveSourceFolderId')
          : await get('driveRulesFolderId');
      if (!folderId) return [];
      const c = getChrome();
      if (!c) return [];
      // Background worker owns the apiClient. We send a request and expect a
      // synchronous-style reply via sendMessage's promise form.
      try {
        const resp = (await c.runtime.sendMessage({
          type: 'list_files_request',
          payload: { folderId, folderType: folder },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)) as { ok?: boolean; files?: FileSummary[] };
        return resp?.files ?? [];
      } catch {
        return [];
      }
    },
  });

  const settingsRoot = renderSettingsTab({
    resetRulesToDefaults: async () => {
      const c = getChrome();
      if (!c) return;
      await c.runtime.sendMessage({
        type: 'seed_defaults_request',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },
    runOnboarding: () => {
      const c = getChrome();
      if (!c) return;
      c.runtime.sendMessage({
        type: 'restart_onboarding',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },
  });

  return { generate, files, settingsRoot };
}

function setActiveTab(
  name: TabName,
  panes: Record<TabName, HTMLElement>,
  buttons: Record<TabName, HTMLButtonElement>,
  container: HTMLElement,
): void {
  container.replaceChildren(panes[name]);
  for (const k of Object.keys(buttons) as TabName[]) {
    buttons[k].classList.toggle('tab-button--active', k === name);
    buttons[k].setAttribute('aria-selected', k === name ? 'true' : 'false');
  }
}

function init(): void {
  const tabContent = document.getElementById('tab-content');
  if (!tabContent) return;
  const navButtons = document.querySelectorAll<HTMLButtonElement>('nav.tabs button[data-tab]');

  const controllers = buildControllers();
  const panes: Record<TabName, HTMLElement> = {
    generate: controllers.generate.root,
    files: controllers.files.root,
    settings: controllers.settingsRoot,
  };
  const buttons: Record<TabName, HTMLButtonElement> = {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    generate: document.querySelector('nav.tabs button[data-tab="generate"]')!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    files: document.querySelector('nav.tabs button[data-tab="files"]')!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    settings: document.querySelector('nav.tabs button[data-tab="settings"]')!,
  };

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabName;
      if (tab) setActiveTab(tab, panes, buttons, tabContent);
    });
  });

  // Default tab
  setActiveTab('generate', panes, buttons, tabContent);

  // Listen for background messages
  const c = getChrome();
  if (c?.runtime?.onMessage) {
    c.runtime.onMessage.addListener((message: Message) => {
      handleMessage(message, controllers);
    });
  }

  // Restore last cached scrape (if any) so the Job Insights card isn't blank.
  void (async () => {
    try {
      const cached = await get('lastJobInsights');
      if (cached?.insights) {
        controllers.generate.applyScraperOutput({
          jd: '',
          company: null,
          role: null,
          url: cached.url,
          scrapeStrategy: 'generic',
          jobInsights: cached.insights,
          scrapedAt: cached.timestamp,
        });
      }
    } catch {
      // ignore
    }
  })();
}

function handleMessage(message: Message, controllers: PanelControllers): void {
  switch (message.type) {
    case 'scrape_result':
      controllers.generate.applyScraperOutput(message.payload);
      break;
    case 'generate_result':
      controllers.generate.setBusy(false);
      if (message.payload.ok) {
        controllers.generate.showGenerateResult(
          message.payload.resumeMd,
          message.payload.docUrl,
          message.payload.jobFolderUrl,
        );
      } else {
        const err = message.payload.error;
        // Minimal error surfacing: alert. A toast component is a v2 polish.
        alert(`Generation failed: ${err.message}`);
      }
      break;
    case 'generate_progress':
      controllers.generate.setBusy(true, message.status);
      break;
    case 'scrape_failure':
      // Render an empty-state Job Insights card; preserve any user-typed JD.
      controllers.generate.applyScraperOutput({
        jd: '',
        company: null,
        role: null,
        url: message.url,
        scrapeStrategy: 'failed',
        jobInsights: null,
        scrapedAt: Date.now(),
      });
      break;
    default:
      // Ignore unknown messages.
      break;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
