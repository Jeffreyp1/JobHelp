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
import { fillResumeTemplate, parseResumeMarkdown } from '../lib/templateFiller.js';
import type { Message } from '../types/message-bus.js';
import type { FileSummary, FolderType } from '../types/api-contract.js';
import { get } from '../lib/storage.js';
import { loadConfigFromDrive } from '../lib/configLoader.js';
import type { JobhelpConfig } from '../types/jobhelp-config.js';

// ─── Runtime config (v2.1, Approach C) ────────────────────────────────────
// Module-scoped cache of the JobhelpConfig loaded from the user's Drive on
// side-panel open. Other tabs read this via `getRuntimeConfig()` instead of
// reaching directly into chrome.storage — which now only stores the file id.
let runtimeConfig: JobhelpConfig | null = null;

/**
 * Return the currently-loaded `JobhelpConfig`, or null if the user has not
 * yet linked a config file (or it failed to load). Tabs that need any of
 * the settings (folder ids, API key, etc.) should call this on each use
 * rather than capturing it at module-load time.
 */
export function getRuntimeConfig(): JobhelpConfig | null {
  return runtimeConfig;
}

/** Internal: set the cached runtime config after a successful load. */
function setRuntimeConfig(config: JobhelpConfig | null): void {
  runtimeConfig = config;
}

// ─── Base64 helpers (browser-safe; rely on btoa/atob + binary string) ────
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked conversion avoids "argument list too long" for large blobs.
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

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

/** Resolve the Apps Script /exec URL from storage and return an ApiClient. */
async function getApiClient(): Promise<ApiClient | null> {
  let url: string | null = null;
  try {
    url = await get('appsScriptUrl');
  } catch {
    return null;
  }
  if (!url) return null;
  return new ApiClient(url);
}

function buildControllers(opts: { autoOpenWizard: boolean } = { autoOpenWizard: false }): PanelControllers {
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
    onConvertViaTemplate: async ({ markdown, jobFolderId }) => {
      let appsScriptUrl: string | null = null;
      let templateId: string | null = null;
      try {
        [appsScriptUrl, templateId] = await Promise.all([
          get('appsScriptUrl'),
          get('driveTemplateDocxId'),
        ]);
      } catch {
        // fall through with empty values
      }
      if (!appsScriptUrl) {
        return { ok: false, message: 'Apps Script URL not configured. Check Settings.' };
      }
      if (!templateId) {
        return {
          ok: false,
          message:
            'No template configured. Set "Drive: template DOCX file ID" in Settings first.',
        };
      }

      const client = new ApiClient(appsScriptUrl);

      // 1. Download template bytes
      const dl = await client.downloadTemplate({ fileId: templateId });
      if (!dl.ok) return { ok: false, message: dl.error.message };

      // 2. Fill template client-side
      let filled: Blob;
      try {
        const buf = base64ToArrayBuffer(dl.base64);
        const data = parseResumeMarkdown(markdown);
        filled = await fillResumeTemplate(buf, data);
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }

      // 3. Upload back to Drive in the job folder
      const b64 = await blobToBase64(filled);
      const fileName = 'tailored_resume_template.docx';
      const up = await client.uploadFilledDocx({
        folderId: jobFolderId,
        fileName,
        base64: b64,
      });
      if (!up.ok) return { ok: false, message: up.error.message };

      return { ok: true, url: up.url, fileName: up.fileName, fileId: up.fileId };
    },

    // ─── v2 feature hooks (direct ApiClient calls; bypass background) ──────
    onResearchCompany: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.researchCompany(req);
    },
    onBenchmarkRole: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.benchmarkRole(req);
    },
    onCritique: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.critique(req);
    },
    onAutoRevise: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.autoRevise(req);
    },
    onCoverLetter: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.coverLetter(req);
    },
    onVerifyClHooks: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.verifyClHooks(req);
    },
    onMultiVersion: async (req) => {
      const client = await getApiClient();
      if (!client) {
        return {
          ok: false,
          error: { type: 'validation', message: 'Apps Script URL not configured.', retryable: false },
        };
      }
      return client.multiVersion(req);
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
    autoOpenWizard: opts.autoOpenWizard,
    onConfigLoaded: (config) => {
      setRuntimeConfig(config);
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

  // ── Step 1: peek at chrome.storage to decide first-run vs. resumed-run. ──
  // The actual config load is async — we kick it off below and treat the
  // result as eventually-consistent. If the file id is missing we route the
  // user to Settings and auto-open the onboarding wizard.
  void (async () => {
    let fileId: string | null = null;
    try {
      fileId = await get('jobhelpConfigFileId');
    } catch {
      // ignore — treat as first-run
    }
    const autoOpenWizard = !fileId;

    const controllers = buildControllers({ autoOpenWizard });
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

    // First-run users land in Settings (with the wizard already open). Returning
    // users land in Generate.
    setActiveTab(fileId ? 'generate' : 'settings', panes, buttons, tabContent);

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

    // ── Step 2: hydrate runtime config from Drive (returning users). ────────
    if (fileId) {
      void hydrateRuntimeConfig(fileId, tabContent, panes, buttons);
    }
  })();
}

/**
 * Fetch + validate the JobhelpConfig from Drive and cache it for the session.
 * On failure, surface a banner above the active tab and switch the user over
 * to Settings so they can fix the file id / config contents.
 */
async function hydrateRuntimeConfig(
  fileId: string,
  tabContent: HTMLElement,
  panes: Record<TabName, HTMLElement>,
  buttons: Record<TabName, HTMLButtonElement>,
): Promise<void> {
  // Build the ApiClient from the legacy storage URL (migration window) — once
  // the config loads, downstream calls can switch to config.appsScriptUrl.
  let appsScriptUrl: string | null = null;
  try {
    appsScriptUrl = await get('appsScriptUrl');
  } catch {
    // ignore
  }
  if (!appsScriptUrl) {
    // No URL available yet. The Settings tab can still let the user paste a
    // config — leave runtimeConfig null and don't show an error banner.
    return;
  }
  const client = new ApiClient(appsScriptUrl);

  try {
    const config = await loadConfigFromDrive(fileId, client);
    setRuntimeConfig(config);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Unknown error';
    showRuntimeConfigError(msg, tabContent, panes, buttons);
  }
}

/** Render a dismissable error banner and force-switch to the Settings tab. */
function showRuntimeConfigError(
  message: string,
  tabContent: HTMLElement,
  panes: Record<TabName, HTMLElement>,
  buttons: Record<TabName, HTMLButtonElement>,
): void {
  const banner = document.createElement('div');
  banner.className = 'runtime-config-error';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('data-runtime-config-error', '');
  banner.textContent = `Couldn't load JobHelp config: ${message}. Check the file ID in Settings.`;
  // Insert above the tab content (sibling of <main>).
  const parent = tabContent.parentElement ?? tabContent;
  parent.insertBefore(banner, tabContent);
  setActiveTab('settings', panes, buttons, tabContent);
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
