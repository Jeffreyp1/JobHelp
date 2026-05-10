/**
 * background.ts
 *
 * MV3 service worker for JobHelp.
 *
 * Responsibilities:
 *   - Listen for tab activation / page-load-complete events and auto-scrape the
 *     active page via chrome.scripting.executeScript.
 *   - Route messages from the side panel (generate_request, rescan_request,
 *     settings_update) to the appropriate handler.
 *   - Relay results back to the side panel via chrome.runtime.sendMessage.
 *
 * The scraper (scraper.ts) is expected to be pre-bundled to
 * public/scraper.bundle.js by the build script.  When injected, the bundle
 * attaches window.__jobhelpScrape() which returns a ScraperOutput.
 */

import type { ScraperOutput } from './types/scraper-output.js';
import type {
  GenerateRequest,
  GenerateResponse,
} from './types/api-contract.js';
import type {
  ScrapeResultMessage,
  ScrapeFailureMessage,
  GenerateResultMessage,
  Message,
} from './types/message-bus.js';
import { get, set } from './lib/storage.js';
import { ApiClient } from './lib/apiClient.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Access chrome via globalThis so tests can stub it cleanly. */
function getChrome(): typeof chrome {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome as typeof chrome;
}

/** URL schemes that the scraper should skip. */
const SKIP_SCHEMES = ['chrome://', 'chrome-extension://', 'about:', 'file://'];

function shouldSkipUrl(url: string): boolean {
  return SKIP_SCHEMES.some((prefix) => url.startsWith(prefix));
}

/** Best-effort sendMessage — swallows "no receiver" errors when panel is closed. */
async function safeSend(message: Message): Promise<void> {
  try {
    await getChrome().runtime.sendMessage(message);
  } catch {
    // Side panel may not be open — ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core handlers (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called when a tab becomes active or a page load completes.
 * Injects the scraper bundle and relays the ScraperOutput to the side panel.
 */
export async function handleTabActivated(info: { tabId: number }): Promise<void> {
  const c = getChrome();

  let tab: chrome.tabs.Tab;
  try {
    tab = await c.tabs.get(info.tabId);
  } catch {
    return; // Tab may have been closed already
  }

  const url = tab.url ?? '';

  if (shouldSkipUrl(url)) {
    return; // Nothing to scrape on chrome:// / extension / about: / file://
  }

  try {
    // Phase 1: inject the pre-bundled scraper so window.__jobhelpScrape is available
    await c.scripting.executeScript({
      target: { tabId: info.tabId },
      files: ['scraper.bundle.js'],
    } as chrome.scripting.ScriptInjection<unknown[], unknown>);

    // Phase 2: call the entry point and retrieve the ScraperOutput
    const results = await c.scripting.executeScript({
      target: { tabId: info.tabId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      func: () => (window as any).__jobhelpScrape() as Promise<ScraperOutput>,
      args: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const fallback: ScraperOutput = {
      jd: '',
      company: null,
      role: null,
      url,
      scrapeStrategy: 'failed',
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scraperOutput: ScraperOutput = (results as any)?.[0]?.result ?? fallback;

    // Persist for side-panel restoration on re-open
    if (scraperOutput.scrapeStrategy !== 'failed' && scraperOutput.jd) {
      await set('lastJobInsights', {
        url: scraperOutput.url,
        insights: scraperOutput.jobInsights ?? ({} as never),
        timestamp: scraperOutput.scrapedAt,
      });
    }

    const message: ScrapeResultMessage & { requiresUserConfirmation: boolean } = {
      type: 'scrape_result',
      payload: scraperOutput,
      // The side panel tracks whether the JD textarea is dirty and decides
      // whether to apply the new JD automatically or prompt the user first.
      // Background always sets this to false; the panel overrides if needed.
      requiresUserConfirmation: false,
    };

    await safeSend(message);
  } catch (err) {
    const reason = (err as Error)?.message ?? 'Unknown scrape error';
    const failure: ScrapeFailureMessage = {
      type: 'scrape_failure',
      reason,
      url,
    };
    await safeSend(failure);
  }
}

/**
 * Handle a generate_request message from the side panel.
 * Reads configuration from storage, delegates to ApiClient, and sends result.
 */
export async function handleGenerateRequest(req: GenerateRequest): Promise<void> {
  const appsScriptUrl = await get('appsScriptUrl');

  if (!appsScriptUrl) {
    const result: GenerateResultMessage = {
      type: 'generate_result',
      payload: {
        ok: false,
        error: {
          type: 'config',
          message: 'Apps Script URL is not configured. Go to Settings.',
          retryable: false,
        },
      } as GenerateResponse,
    };
    await safeSend(result);
    return;
  }

  const client = new ApiClient(appsScriptUrl);
  const response = await client.generate({
    jd: req.jd,
    company: req.company,
    role: req.role,
    url: req.url,
    jobInsights: req.jobInsights,
    toggles: req.toggles,
    sourceFolderId: req.sourceFolderId,
    rulesFolderId: req.rulesFolderId,
    outputFolderId: req.outputFolderId,
    sheetId: req.sheetId,
    model: req.model,
  });

  const result: GenerateResultMessage = {
    type: 'generate_result',
    payload: response,
  };
  await safeSend(result);
}

/**
 * Re-scrape the currently active tab on demand (rescan_request from panel).
 */
export async function handleRescanRequest(): Promise<void> {
  const c = getChrome();
  const tabs = await c.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.id !== undefined) {
    await handleTabActivated({ tabId: tab.id });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service worker event wiring
// (Only registered when running as an actual extension, not in test environment)
// ─────────────────────────────────────────────────────────────────────────────

function isExtensionContext(): boolean {
  try {
    const c = getChrome();
    return !!c?.runtime?.id;
  } catch {
    return false;
  }
}

if (isExtensionContext()) {
  const c = getChrome();

  // Open side panel when extension icon is clicked
  c.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).sidePanel.open({ windowId: tab.windowId });
    }
  });

  // Auto-scrape on tab switch
  c.tabs.onActivated.addListener((info) => {
    void handleTabActivated({ tabId: info.tabId });
  });

  // Auto-scrape when a page finishes loading
  c.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete') {
      void handleTabActivated({ tabId });
    }
  });

  // Route side-panel messages
  c.runtime.onMessage.addListener(
    (
      msg: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message = msg as Message | { type: string; payload?: any };

      switch (message.type) {
        case 'generate_request':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void handleGenerateRequest((message as any).payload);
          return false;

        case 'rescan_request':
          void handleRescanRequest();
          return false;

        case 'settings_update':
          void (async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const [key, value] of Object.entries((message as any).payload)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await set(key as Parameters<typeof set>[0], value as never);
            }
          })();
          return false;

        // Async handlers that need to send a response back to the sender
        // (the side panel awaits sendMessage's promise). Returning `true`
        // keeps the response channel open until sendResponse is called.
        case 'list_files_request': {
          void (async () => {
            try {
              const url = await get('appsScriptUrl');
              if (!url) {
                sendResponse({ ok: false, error: { type: 'config', message: 'No Apps Script URL configured', retryable: false } });
                return;
              }
              const client = new ApiClient(url);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { folderId, folderType } = (message as any).payload;
              const resp = await client.listFiles({ folderId, folderType });
              sendResponse(resp);
            } catch (err) {
              sendResponse({ ok: false, error: { type: 'server', message: (err as Error).message, retryable: true } });
            }
          })();
          return true; // async response
        }

        case 'seed_defaults_request': {
          void (async () => {
            try {
              const url = await get('appsScriptUrl');
              if (!url) {
                sendResponse({ ok: false, error: { type: 'config', message: 'No Apps Script URL configured', retryable: false } });
                return;
              }
              const client = new ApiClient(url);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const payload = (message as any).payload;
              const resp = await client.seedDefaults(payload);
              sendResponse(resp);
            } catch (err) {
              sendResponse({ ok: false, error: { type: 'server', message: (err as Error).message, retryable: true } });
            }
          })();
          return true;
        }

        default:
          return false;
      }
    },
  );
}
