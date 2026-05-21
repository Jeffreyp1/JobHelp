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
import { renderJobsTab, type JobsTabController } from './tabs/jobs.js';
import { renderSettingsTab } from './tabs/settings.js';
import { ApiClient } from '../lib/apiClient.js';
import { fillResumeTemplate, parseResumeMarkdown } from '../lib/templateFiller.js';
import type { Message } from '../types/message-bus.js';
import type { FileSummary, FolderType } from '../types/api-contract.js';
import type { JobProfile, DiscoveryConfig, RankedJob, JobPipelineStatus } from '../types/job-discovery.js';
import { get, set } from '../lib/storage.js';
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

/**
 * Set the cached runtime config directly.
 *
 * Primarily used internally by {@link applyRuntimeConfig} after a successful
 * Drive load. Also exported so tests can prime the module-scoped config
 * without going through the async Drive-load path.
 */
export function setRuntimeConfig(config: JobhelpConfig | null): void {
  runtimeConfig = config;
}

/**
 * Adopt a freshly-loaded `JobhelpConfig` for the rest of the session AND
 * mirror its resolved values back into the legacy `chrome.storage.local`
 * keys.
 *
 * The mirror-write is a one-way bridge: the Drive-hosted `jobhelp-config.json`
 * is the source of truth, but the background service worker (`background.ts`)
 * still reads the individual legacy keys (`appsScriptUrl`, `driveSourceFolderId`,
 * …). Keeping those keys populated as a derived cache lets the background worker
 * keep functioning with zero changes — the side panel just refreshes the cache
 * every time it (re)hydrates the config from Drive.
 *
 * Best-effort: storage failures are swallowed so a transient write error never
 * blocks the UI from using the in-memory config it already has.
 */
function applyRuntimeConfig(config: JobhelpConfig): void {
  setRuntimeConfig(config);
  // Fire-and-forget mirror write — the in-memory config is already live.
  void (async () => {
    try {
      await Promise.all([
        set('appsScriptUrl', config.appsScriptUrl),
        set('driveSourceFolderId', config.folders.source),
        set('driveRulesFolderId', config.folders.rules),
        set('driveOutputFolderId', config.folders.output),
        set('sheetId', config.sheetId),
        set('driveTemplateDocxId', config.templateDocxId),
        set('defaultGenerateModel', config.defaults.model),
      ]);
    } catch {
      // Legacy keys are a derived cache; a write failure is non-fatal.
    }
  })();
}

/**
 * Apps Script /exec URL for the current session — prefers the loaded runtime
 * config, falling back to the legacy storage key during the migration window
 * (before the Drive config has finished loading, or if it failed to load).
 */
async function resolveAppsScriptUrl(): Promise<string | null> {
  const cfg = getRuntimeConfig();
  if (cfg?.appsScriptUrl) return cfg.appsScriptUrl;
  try {
    return await get('appsScriptUrl');
  } catch {
    return null;
  }
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

type TabName = 'generate' | 'files' | 'jobs' | 'settings';

interface PanelControllers {
  generate: GenerateTabController;
  files: FilesTabController;
  jobs: JobsTabController;
  settingsRoot: HTMLElement;
}

// ─── Job-pipeline discovery config (not yet in JobhelpConfig) ─────────────
// `JobhelpConfig` currently carries no `discovery` block, so the Jobs tab
// reads the discovery-source credentials/targets from these raw
// chrome.storage.local keys. They're flat scalars / JSON strings written by
// (eventually) a Settings panel section. Treated as optional — an empty set
// just yields an empty digest.
const JOB_PROFILE_KEY = 'jobProfile';
const DISCOVERY_KEYS = {
  adzunaAppId: 'adzunaAppId',
  adzunaAppKey: 'adzunaAppKey',
  jsearchRapidApiKey: 'jsearchRapidApiKey',
  greenhouseBoards: 'greenhouseBoards',
  leverClients: 'leverClients',
  usajobs: 'usajobs',
  country: 'country',
} as const;

/** Raw chrome.storage.local read for keys outside the typed StorageSchema. */
async function rawStorageGet(keys: string[]): Promise<Record<string, unknown>> {
  const c = getChrome();
  if (!c?.storage?.local) return {};
  try {
    return await c.storage.local.get(keys);
  } catch {
    return {};
  }
}

/** Raw chrome.storage.local write for keys outside the typed StorageSchema. */
async function rawStorageSet(items: Record<string, unknown>): Promise<void> {
  const c = getChrome();
  if (!c?.storage?.local) return;
  try {
    await c.storage.local.set(items);
  } catch {
    // best-effort cache write
  }
}

function parseJsonArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      // not JSON — fall back to comma-split
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return undefined;
}

/** Assemble a DiscoveryConfig from the raw storage keys (all fields optional). */
async function loadDiscoveryConfig(): Promise<DiscoveryConfig> {
  const raw = await rawStorageGet(Object.values(DISCOVERY_KEYS));
  const config: DiscoveryConfig = {};
  const adzunaAppId = raw[DISCOVERY_KEYS.adzunaAppId];
  const adzunaAppKey = raw[DISCOVERY_KEYS.adzunaAppKey];
  if (typeof adzunaAppId === 'string' && adzunaAppId) config.adzunaAppId = adzunaAppId;
  if (typeof adzunaAppKey === 'string' && adzunaAppKey) config.adzunaAppKey = adzunaAppKey;
  const jsearch = raw[DISCOVERY_KEYS.jsearchRapidApiKey];
  if (typeof jsearch === 'string' && jsearch) config.jsearchRapidApiKey = jsearch;
  const gh = parseJsonArray(raw[DISCOVERY_KEYS.greenhouseBoards]);
  if (gh && gh.length) config.greenhouseBoards = gh;
  const lever = parseJsonArray(raw[DISCOVERY_KEYS.leverClients]);
  if (lever && lever.length) config.leverClients = lever;
  if (raw[DISCOVERY_KEYS.usajobs] === true || raw[DISCOVERY_KEYS.usajobs] === 'true') config.usajobs = true;
  const country = raw[DISCOVERY_KEYS.country];
  if (typeof country === 'string' && country) config.country = country;
  return config;
}

function getChrome(): typeof chrome | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  if (c?.runtime?.sendMessage) return c as typeof chrome;
  return null;
}

/** Resolve the Apps Script /exec URL and return an ApiClient (or null). */
async function getApiClient(): Promise<ApiClient | null> {
  const url = await resolveAppsScriptUrl();
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
    onSaveResume: async (md) => {
      const appsScriptUrl = await resolveAppsScriptUrl();
      if (!appsScriptUrl) {
        return {
          ok: false as const,
          message: 'JobHelp config not loaded. Run setup in Settings first.',
        };
      }
      const fileId = generate.getResumeFileId();
      if (!fileId) {
        return {
          ok: false as const,
          message: 'Could not determine the resume file to save to. Re-generate the resume.',
        };
      }
      const client = new ApiClient(appsScriptUrl);
      const resp = await client.writeFile({ fileId, newContents: md });
      if (!resp.ok) {
        return { ok: false as const, message: resp.error.message };
      }
      return { ok: true as const, savedAt: resp.updatedAt };
    },
    onFinalize: async ({ format, markdown, docId, jobFolderId }) => {
      const appsScriptUrl = await resolveAppsScriptUrl();
      if (!appsScriptUrl) {
        return { ok: false, message: 'JobHelp config not loaded. Run setup in Settings first.' };
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
      const cfg = getRuntimeConfig();
      const appsScriptUrl = await resolveAppsScriptUrl();
      if (!appsScriptUrl) {
        return { ok: false, message: 'JobHelp config not loaded. Run setup in Settings first.' };
      }
      const templateId = cfg?.templateDocxId ?? null;
      if (!templateId) {
        return {
          ok: false,
          message: 'No template configured in your jobhelp-config.json. Run setup in Settings first.',
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
      const cfg = getRuntimeConfig();
      if (!cfg) return [];
      const folderId = folder === 'source' ? cfg.folders.source : cfg.folders.rules;
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

  const jobs = renderJobsTab({
    onExtractProfile: async () => {
      const client = await getApiClient();
      const cfg = getRuntimeConfig();
      if (!client || !cfg) {
        return { ok: false as const, message: 'JobHelp config not loaded. Run setup in Settings first.' };
      }
      const resp = await client.extractProfile({
        sourceFolderId: cfg.folders.source,
        model: cfg.defaults.model,
      });
      if (!resp.ok) return { ok: false as const, message: resp.error.message };
      jobs.setProfile(resp.profile);
      await rawStorageSet({ [JOB_PROFILE_KEY]: resp.profile });
      return { ok: true as const, profile: resp.profile };
    },
    onRunDigest: async ({ maxDaysOld, topN, fitScoreModel }) => {
      const client = await getApiClient();
      const cfg = getRuntimeConfig();
      if (!client || !cfg) {
        return { ok: false as const, message: 'JobHelp config not loaded. Run setup in Settings first.' };
      }
      // Profile: prefer the in-memory cache, then chrome.storage, then extract.
      let profile: JobProfile | null = jobs.getProfile();
      if (!profile) {
        const cached = await rawStorageGet([JOB_PROFILE_KEY]);
        const stored = cached[JOB_PROFILE_KEY];
        if (stored && typeof stored === 'object') {
          profile = stored as JobProfile;
          jobs.setProfile(profile);
        }
      }
      if (!profile) {
        const extracted = await client.extractProfile({
          sourceFolderId: cfg.folders.source,
          model: cfg.defaults.model,
        });
        if (!extracted.ok) return { ok: false as const, message: extracted.error.message };
        profile = extracted.profile;
        jobs.setProfile(profile);
        await rawStorageSet({ [JOB_PROFILE_KEY]: profile });
      }
      if (!cfg.sheetId) {
        return { ok: false as const, message: 'No tracking sheet configured. Run setup in Settings first.' };
      }
      const discoveryConfig = await loadDiscoveryConfig();
      const resp = await client.discoverAndRank({
        profile,
        config: discoveryConfig,
        maxDaysOld,
        topN,
        fitScoreModel,
        sheetId: cfg.sheetId,
      });
      if (!resp.ok) return { ok: false as const, message: resp.error.message };
      return { ok: true as const, result: resp };
    },
    onTailorJob: (job: RankedJob) => {
      // Prefill the Generate tab with this job's JD/company/role, then switch
      // to it. We reuse the Generate tab's existing scraper-output ingestion
      // path rather than wiring a dedicated message-bus event — the user then
      // clicks Generate. (See CROSS-IMPACT note for the richer integration.)
      try {
        generate.applyScraperOutput({
          jd: job.descriptionText ?? '',
          company: job.company || null,
          role: job.title || null,
          url: job.url,
          scrapeStrategy: 'generic',
          jobInsights: null,
          scrapedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[jobs] could not prefill Generate tab:', e);
      }
    },
    onMarkStatus: async (jobId: string, status: JobPipelineStatus, tailoredDocUrl?: string) => {
      const client = await getApiClient();
      const cfg = getRuntimeConfig();
      if (!client || !cfg?.sheetId) {
        console.warn('[jobs] cannot update status — config or sheetId missing.');
        return;
      }
      const resp = await client.updateJobStatus({
        sheetId: cfg.sheetId,
        jobId,
        status,
        tailoredDocUrl,
      });
      if (!resp.ok) {
        console.warn('[jobs] updateJobStatus failed:', resp.error.message);
      }
    },
  });

  const settingsRoot = renderSettingsTab({
    autoOpenWizard: opts.autoOpenWizard,
    onConfigLoaded: (config) => {
      // Adopt + mirror back into the legacy keys so the background worker
      // and the Generate/Files tabs immediately see the new values.
      applyRuntimeConfig(config);
    },
  });

  return { generate, files, jobs, settingsRoot };
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

/**
 * Ensure a nav button exists for the given tab. The static index.html ships
 * Generate/Files/Settings; the Jobs tab is injected here so the HTML asset
 * stays untouched (see CROSS-IMPACT note). Returns the button element.
 */
function ensureNavButton(tab: TabName, label: string): HTMLButtonElement | null {
  const existing = document.querySelector<HTMLButtonElement>(`nav.tabs button[data-tab="${tab}"]`);
  if (existing) return existing;
  const nav = document.querySelector('nav.tabs');
  if (!nav) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.tab = tab;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', 'false');
  btn.textContent = label;
  // Insert before the Settings button so Jobs sits next to Files.
  const settingsBtn = nav.querySelector('button[data-tab="settings"]');
  if (settingsBtn) nav.insertBefore(btn, settingsBtn);
  else nav.appendChild(btn);
  return btn;
}

function init(): void {
  const tabContent = document.getElementById('tab-content');
  if (!tabContent) return;
  // Inject the Jobs nav button (idempotent) before we snapshot the node list.
  ensureNavButton('jobs', 'Jobs');
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
      jobs: controllers.jobs.root,
      settings: controllers.settingsRoot,
    };
    const buttons: Record<TabName, HTMLButtonElement> = {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      generate: document.querySelector('nav.tabs button[data-tab="generate"]')!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      files: document.querySelector('nav.tabs button[data-tab="files"]')!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      jobs: document.querySelector('nav.tabs button[data-tab="jobs"]')!,
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
    // Adopt the config AND mirror its values into the legacy chrome.storage
    // keys so the background worker keeps working unchanged (it still reads
    // appsScriptUrl / driveSourceFolderId / … directly).
    applyRuntimeConfig(config);
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
          message.payload.sheetRowUrl,
          message.payload.mdFileUrl,
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
