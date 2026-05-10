// extension/src/types/storage-schema.ts
var STORAGE_DEFAULTS = {
  appsScriptUrl: null,
  anthropicApiKey: null,
  driveSourceFolderId: null,
  driveRulesFolderId: null,
  driveOutputFolderId: null,
  driveTemplateDocxId: null,
  sheetId: null,
  defaultGenerateModel: "claude-haiku-4-5-20251001",
  lastToggles: {},
  presets: [],
  onboardingState: "noConfig",
  lastJobInsights: null
};

// extension/src/lib/storage.ts
function hasChromeStorage() {
  const c = globalThis.chrome;
  return !!c && !!c.storage && !!c.storage.local;
}
async function get(key) {
  if (!hasChromeStorage()) {
    return STORAGE_DEFAULTS[key];
  }
  const c = globalThis.chrome;
  const result = await c.storage.local.get(key);
  if (key in result && result[key] !== void 0) {
    return result[key];
  }
  return STORAGE_DEFAULTS[key];
}
async function set(key, value) {
  if (!hasChromeStorage()) {
    return;
  }
  const c = globalThis.chrome;
  await c.storage.local.set({ [key]: value });
}

// extension/src/lib/apiClient.ts
function networkError(message) {
  return {
    ok: false,
    error: {
      type: "server",
      message,
      retryable: true
    }
  };
}
var ApiClient = class {
  constructor(appsScriptUrl) {
    this.appsScriptUrl = appsScriptUrl;
  }
  /** POST a request body to the Apps Script endpoint and parse JSON response. */
  async post(body) {
    let response;
    try {
      response = await fetch(this.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (err) {
      const message = err?.message ?? "Network request failed";
      return networkError(message);
    }
    if (!response.ok) {
      return networkError(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
  /**
   * Trigger the generate pipeline on the backend.
   * Returns a GenerateResponse (ok:true with result, or ok:false with error).
   */
  async generate(req) {
    return this.post({ action: "generate", ...req });
  }
  /** List files in a Drive folder (source or rules). */
  async listFiles(req) {
    return this.post({ action: "list_files", ...req });
  }
  /** Overwrite a Drive file's contents. */
  async writeFile(req) {
    return this.post({ action: "write_file", ...req });
  }
  /** Seed the user's rules folder with default prompt files from GitHub. */
  async seedDefaults(req) {
    return this.post({ action: "seed_defaults", ...req });
  }
  /** Health check — verifies the Apps Script endpoint is reachable. */
  async ping() {
    return this.post({ action: "ping" });
  }
  /**
   * Convert the (possibly user-edited) markdown to DOCX and/or PDF.
   * Updates the existing tailored_resume Doc, then exports to the requested
   * formats into the same job folder.
   */
  async finalize(req) {
    return this.post({ action: "finalize", ...req });
  }
  /**
   * Download the user's uploaded resume template DOCX from Drive as base64.
   * Used by the "Convert via Template (DOCX)" flow before client-side fill.
   */
  async downloadTemplate(req) {
    return this.post({ action: "download_template", ...req });
  }
  /**
   * Upload a base64-encoded DOCX (the result of fillResumeTemplate) into a
   * Drive folder and return the resulting file URL.
   */
  async uploadFilledDocx(req) {
    return this.post({ action: "upload_filled_docx", ...req });
  }
};

// extension/src/background.ts
function getChrome() {
  return globalThis.chrome;
}
var SKIP_SCHEMES = ["chrome://", "chrome-extension://", "about:", "file://"];
function shouldSkipUrl(url) {
  return SKIP_SCHEMES.some((prefix) => url.startsWith(prefix));
}
async function safeSend(message) {
  try {
    await getChrome().runtime.sendMessage(message);
  } catch {
  }
}
async function handleTabActivated(info) {
  const c = getChrome();
  let tab;
  try {
    tab = await c.tabs.get(info.tabId);
  } catch {
    return;
  }
  const url = tab.url ?? "";
  if (shouldSkipUrl(url)) {
    return;
  }
  try {
    await c.scripting.executeScript({
      target: { tabId: info.tabId },
      files: ["scraper.bundle.js"]
    });
    const results = await c.scripting.executeScript({
      target: { tabId: info.tabId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      func: () => window.__jobhelpScrape(),
      args: []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    });
    const fallback = {
      jd: "",
      company: null,
      role: null,
      url,
      scrapeStrategy: "failed",
      jobInsights: null,
      scrapedAt: Date.now()
    };
    const scraperOutput = results?.[0]?.result ?? fallback;
    if (scraperOutput.scrapeStrategy !== "failed" && scraperOutput.jd) {
      await set("lastJobInsights", {
        url: scraperOutput.url,
        insights: scraperOutput.jobInsights ?? {},
        timestamp: scraperOutput.scrapedAt
      });
    }
    const message = {
      type: "scrape_result",
      payload: scraperOutput,
      // The side panel tracks whether the JD textarea is dirty and decides
      // whether to apply the new JD automatically or prompt the user first.
      // Background always sets this to false; the panel overrides if needed.
      requiresUserConfirmation: false
    };
    await safeSend(message);
  } catch (err) {
    const reason = err?.message ?? "Unknown scrape error";
    const failure = {
      type: "scrape_failure",
      reason,
      url
    };
    await safeSend(failure);
  }
}
async function handleGenerateRequest(req) {
  const appsScriptUrl = await get("appsScriptUrl");
  if (!appsScriptUrl) {
    const result2 = {
      type: "generate_result",
      payload: {
        ok: false,
        error: {
          type: "config",
          message: "Apps Script URL is not configured. Go to Settings.",
          retryable: false
        }
      }
    };
    await safeSend(result2);
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
    model: req.model
  });
  const result = {
    type: "generate_result",
    payload: response
  };
  await safeSend(result);
}
async function handleRescanRequest() {
  const c = getChrome();
  const tabs = await c.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.id !== void 0) {
    await handleTabActivated({ tabId: tab.id });
  }
}
function isExtensionContext() {
  try {
    const c = getChrome();
    return !!c?.runtime?.id;
  } catch {
    return false;
  }
}
if (isExtensionContext()) {
  const c = getChrome();
  c.action.onClicked.addListener((tab) => {
    if (tab.windowId !== void 0) {
      c.sidePanel.open({ windowId: tab.windowId });
    }
  });
  c.tabs.onActivated.addListener((info) => {
    void handleTabActivated({ tabId: info.tabId });
  });
  c.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete") {
      void handleTabActivated({ tabId });
    }
  });
  c.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      const message = msg;
      switch (message.type) {
        case "generate_request":
          void handleGenerateRequest(message.payload);
          return false;
        case "rescan_request":
          void handleRescanRequest();
          return false;
        case "settings_update":
          void (async () => {
            for (const [key, value] of Object.entries(message.payload)) {
              await set(key, value);
            }
          })();
          return false;
        case "list_files_request": {
          void (async () => {
            try {
              const url = await get("appsScriptUrl");
              if (!url) {
                sendResponse({ ok: false, error: { type: "config", message: "No Apps Script URL configured", retryable: false } });
                return;
              }
              const client = new ApiClient(url);
              const { folderId, folderType } = message.payload;
              const resp = await client.listFiles({ folderId, folderType });
              sendResponse(resp);
            } catch (err) {
              sendResponse({ ok: false, error: { type: "server", message: err.message, retryable: true } });
            }
          })();
          return true;
        }
        case "seed_defaults_request": {
          void (async () => {
            try {
              const url = await get("appsScriptUrl");
              if (!url) {
                sendResponse({ ok: false, error: { type: "config", message: "No Apps Script URL configured", retryable: false } });
                return;
              }
              const client = new ApiClient(url);
              const payload = message.payload;
              const resp = await client.seedDefaults(payload);
              sendResponse(resp);
            } catch (err) {
              sendResponse({ ok: false, error: { type: "server", message: err.message, retryable: true } });
            }
          })();
          return true;
        }
        default:
          return false;
      }
    }
  );
}
export {
  handleGenerateRequest,
  handleRescanRequest,
  handleTabActivated
};
//# sourceMappingURL=background.js.map
