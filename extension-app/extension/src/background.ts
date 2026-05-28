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
import { log } from './lib/structuredLog.js';

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

/**
 * `chrome.runtime.sendMessage` rejects with this (or a close variant) when no
 * receiver is registered — i.e. the side panel is simply closed. That's the
 * one error class it's legitimate to swallow silently.
 */
const NO_RECEIVER_RE = /receiving end does not exist|could not establish connection|message port closed/i;

/**
 * Best-effort sendMessage to the side panel.
 *
 * "Side panel not open" (no receiver) is swallowed silently — that's expected.
 * Every OTHER failure (malformed message, MV3 service-worker teardown mid-send,
 * etc.) is logged via the structured logger so a dropped generate/scrape result
 * leaves a trace instead of vanishing (audit H1).
 */
async function safeSend(message: Message): Promise<void> {
  try {
    await getChrome().runtime.sendMessage(message);
  } catch (err) {
    const reason = (err as Error)?.message ?? String(err);
    if (NO_RECEIVER_RE.test(reason)) {
      return; // Side panel not open — expected, nothing to do.
    }
    log('warn', 'background: sendMessage to side panel failed', {
      messageType: (message as { type?: string })?.type,
      error: reason,
    });
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
  } catch (err) {
    // "No tab with id" is the common (benign) case — the tab was closed
    // between the event firing and us handling it. Anything else (a
    // permissions revocation, an extension-reload race) is worth a trace so
    // auto-scrape silently breaking is at least diagnosable (audit H3).
    const reason = (err as Error)?.message ?? String(err);
    if (!/no tab with id|invalid tab id/i.test(reason)) {
      log('warn', 'background: tabs.get failed', { tabId: info.tabId, error: reason });
    }
    return;
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
    const rawResult = (results as any)?.[0]?.result;
    const scraperOutput: ScraperOutput = rawResult ?? fallback;
    if (!rawResult) {
      // The injected scraper returned nothing (entry point missing, page CSP
      // blocked the bundle, etc.) — we fall back to a 'failed' ScraperOutput,
      // but log it so this isn't an invisible degradation (audit-adjacent).
      log('warn', 'background: scraper entry point returned no result', { url });
    } else if (scraperOutput.scrapeStrategy === 'failed') {
      log('info', 'background: scrape produced no JD', { url });
    }

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
    // The scrape_failure message goes through safeSend, which silently drops
    // it if the panel is closed. Log here so there is always a record of the
    // failure even when the user reopens the panel later and sees stale state
    // (audit H2 — full fix is persisting last-N failures to storage.session,
    // which needs a storage-schema change; flagged).
    log('warn', 'background: scrape pipeline failed', { url, error: reason });
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
            const entries = Object.entries((message as any).payload ?? {});
            // Write every key independently so one failing `set` doesn't
            // silently abandon the rest (audit M20). The panel doesn't await
            // this message, so we surface any failures via the logger.
            const results = await Promise.allSettled(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              entries.map(([key, value]) =>
                set(key as Parameters<typeof set>[0], value as never),
              ),
            );
            const failed = results
              .map((r, i) => ({ r, key: entries[i][0] }))
              .filter((x) => x.r.status === 'rejected');
            if (failed.length > 0) {
              log('error', 'background: settings_update failed to persist some keys', {
                keys: failed.map((f) => f.key),
                errors: failed.map((f) =>
                  (f.r as PromiseRejectedResult).reason instanceof Error
                    ? (f.r as PromiseRejectedResult).reason.message
                    : String((f.r as PromiseRejectedResult).reason),
                ),
              });
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
              const msg = (err as Error)?.message ?? String(err);
              log('warn', 'background: list_files_request handler failed', { error: msg });
              sendResponse({ ok: false, error: { type: 'server', message: msg, retryable: true } });
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
              const msg = (err as Error)?.message ?? String(err);
              log('warn', 'background: seed_defaults_request handler failed', { error: msg });
              sendResponse({ ok: false, error: { type: 'server', message: msg, retryable: true } });
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
