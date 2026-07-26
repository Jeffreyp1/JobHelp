// extension-app/extension/src/types/storage-schema.ts
var STORAGE_DEFAULTS = {
  jobhelpConfigFileId: null,
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
  lastJobInsights: null,
  lastDigest: null,
  v2Toggles: null,
  autofillProfile: null,
  autofillResumeDump: null
};

// extension-app/extension/src/lib/storage.ts
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

// extension-app/extension/src/lib/structuredLog.ts
var minLevel = "debug";
var LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var SECRET_KEY_RE = /api[-_]?key|token|secret|password|authorization|x-api-key/i;
var ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
var MAX_STRING_BYTES = 2048;
var MAX_REDACT_DEPTH = 6;
function utf8ByteLength(s) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s).length;
  }
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 55296 && code <= 56319) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
function truncateLongString(s) {
  const totalBytes = utf8ByteLength(s);
  if (totalBytes <= MAX_STRING_BYTES) return s;
  const head = s.slice(0, 200);
  const remaining = totalBytes - utf8ByteLength(head);
  return `${head} ... <truncated, ${remaining} more bytes>`;
}
function redact(value, depth) {
  if (depth > MAX_REDACT_DEPTH) return "<max-depth>";
  if (value === null || value === void 0) return value;
  const t = typeof value;
  if (t === "string") {
    const s = value;
    if (ANTHROPIC_KEY_RE.test(s)) return "<redacted>";
    return truncateLongString(s);
  }
  if (t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (t === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = "<redacted>";
      } else {
        out[key] = redact(value[key], depth + 1);
      }
    }
    return out;
  }
  try {
    return String(value);
  } catch {
    return "<unserialisable>";
  }
}
function redactContext(ctx) {
  if (!ctx) return void 0;
  return redact(ctx, 0);
}
var RING_CAPACITY = 100;
var ring = [];
function buildEntry(level, msg, ctx) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const redacted = redactContext(ctx);
  const entry = { ts, level, msg };
  if (redacted !== void 0) entry.ctx = redacted;
  return entry;
}
function formatEntry(entry) {
  let body;
  try {
    body = JSON.stringify(entry);
  } catch {
    body = JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      msg: entry.msg,
      ctx: { _logError: "JSON.stringify failed" }
    });
  }
  return `[JobHelp] ${body}`;
}
function consoleFor(level) {
  const c = globalThis.console ?? console;
  switch (level) {
    case "debug":
      return (c.log ?? c.info ?? c.warn).bind(c);
    case "info":
      return (c.info ?? c.log).bind(c);
    case "warn":
      return (c.warn ?? c.log).bind(c);
    case "error":
      return (c.error ?? c.log).bind(c);
  }
}
function pushRing(entry) {
  ring.push(entry);
  while (ring.length > RING_CAPACITY) ring.shift();
}
function log(level, msg, ctx) {
  const entry = buildEntry(level, msg, ctx);
  pushRing(entry);
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const line = formatEntry(entry);
  consoleFor(level)(line);
}

// extension-app/extension/src/lib/apiClient-post.ts
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
function headSnippet(s, n = 200) {
  return s.slice(0, n).replace(/\s+/g, " ").trim();
}
async function postToAppsScript(appsScriptUrl, body) {
  let response;
  try {
    response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    const message = err?.message ?? "Network request failed";
    log("warn", "apiClient: network request failed", {
      action: body.action,
      error: message
    });
    return networkError(message);
  }
  if (!response.ok) {
    log("warn", "apiClient: HTTP error response", {
      action: body.action,
      status: response.status,
      statusText: response.statusText
    });
    return networkError(`HTTP ${response.status}: ${response.statusText}`);
  }
  let rawText;
  try {
    rawText = await response.text();
  } catch (err) {
    const message = err?.message ?? "Failed to read response body";
    log("error", "apiClient: failed to read response body", {
      action: body.action,
      error: message
    });
    return networkError(message);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const snippet = headSnippet(rawText);
    log("error", "apiClient: response was not valid JSON", {
      action: body.action,
      bodySnippet: snippet
    });
    return networkError(`Response was not valid JSON: ${snippet}`);
  }
  if (typeof parsed !== "object" || parsed === null || typeof parsed.ok !== "boolean") {
    const snippet = headSnippet(rawText);
    log("error", "apiClient: malformed response \u2014 missing ok flag", {
      action: body.action,
      bodySnippet: snippet
    });
    return networkError(`Malformed response \u2014 missing ok flag: ${snippet}`);
  }
  return parsed;
}

// extension-app/extension/src/lib/apiClient.ts
var ApiClient = class {
  constructor(appsScriptUrl) {
    this.appsScriptUrl = appsScriptUrl;
  }
  async post(body) {
    return postToAppsScript(this.appsScriptUrl, body);
  }
  async generate(req) {
    return this.post({ action: "generate", ...req });
  }
  async listFiles(req) {
    return this.post({ action: "list_files", ...req });
  }
  async writeFile(req) {
    return this.post({ action: "write_file", ...req });
  }
  async seedDefaults(req) {
    return this.post({ action: "seed_defaults", ...req });
  }
  async ping() {
    return this.post({ action: "ping" });
  }
  async finalize(req) {
    return this.post({ action: "finalize", ...req });
  }
  async downloadTemplate(req) {
    return this.post({ action: "download_template", ...req });
  }
  async uploadFilledDocx(req) {
    return this.post({ action: "upload_filled_docx", ...req });
  }
  async createDriveFile(req) {
    return this.post({ action: "create_drive_file", ...req });
  }
  async researchCompany(req) {
    return this.post({ action: "research_company", ...req });
  }
  async benchmarkRole(req) {
    return this.post({ action: "benchmark_role", ...req });
  }
  async critique(req) {
    return this.post({ action: "critique", ...req });
  }
  async autoRevise(req) {
    return this.post({ action: "auto_revise", ...req });
  }
  async autoReviseScoped(req) {
    return this.post({ action: "auto_revise_scoped", ...req });
  }
  async coverLetter(req) {
    return this.post({ action: "cover_letter", ...req });
  }
  async verifyClHooks(req) {
    return this.post({ action: "verify_cl_hooks", ...req });
  }
  async multiVersion(req) {
    return this.post({ action: "multi_version", ...req });
  }
  async extractProfile(req) {
    return this.post({ action: "extract_profile", ...req });
  }
  async discoverAndRank(req) {
    return this.post({ action: "discover_and_rank", ...req });
  }
  async updateJobStatus(req) {
    return this.post({ action: "update_job_status", ...req });
  }
};

// extension-app/extension/src/background.ts
function getChrome() {
  return globalThis.chrome;
}
var SKIP_SCHEMES = ["chrome://", "chrome-extension://", "about:", "file://"];
function shouldSkipUrl(url) {
  return SKIP_SCHEMES.some((prefix) => url.startsWith(prefix));
}
var NO_RECEIVER_RE = /receiving end does not exist|could not establish connection|message port closed/i;
async function safeSend(message) {
  try {
    await getChrome().runtime.sendMessage(message);
  } catch (err) {
    const reason = err?.message ?? String(err);
    if (NO_RECEIVER_RE.test(reason)) {
      return;
    }
    log("warn", "background: sendMessage to side panel failed", {
      messageType: message?.type,
      error: reason
    });
  }
}
async function handleTabActivated(info) {
  const c = getChrome();
  let tab;
  try {
    tab = await c.tabs.get(info.tabId);
  } catch (err) {
    const reason = err?.message ?? String(err);
    if (!/no tab with id|invalid tab id/i.test(reason)) {
      log("warn", "background: tabs.get failed", { tabId: info.tabId, error: reason });
    }
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
    const rawResult = results?.[0]?.result;
    const scraperOutput = rawResult ?? fallback;
    if (!rawResult) {
      log("warn", "background: scraper entry point returned no result", { url });
    } else if (scraperOutput.scrapeStrategy === "failed") {
      log("info", "background: scrape produced no JD", { url });
    }
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
    log("warn", "background: scrape pipeline failed", { url, error: reason });
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
            const entries = Object.entries(message.payload ?? {});
            const results = await Promise.allSettled(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              entries.map(
                ([key, value]) => set(key, value)
              )
            );
            const failed = results.map((r, i) => ({ r, key: entries[i][0] })).filter((x) => x.r.status === "rejected");
            if (failed.length > 0) {
              log("error", "background: settings_update failed to persist some keys", {
                keys: failed.map((f) => f.key),
                errors: failed.map(
                  (f) => f.r.reason instanceof Error ? f.r.reason.message : String(f.r.reason)
                )
              });
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
              const msg2 = err?.message ?? String(err);
              log("warn", "background: list_files_request handler failed", { error: msg2 });
              sendResponse({ ok: false, error: { type: "server", message: msg2, retryable: true } });
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
              const msg2 = err?.message ?? String(err);
              log("warn", "background: seed_defaults_request handler failed", { error: msg2 });
              sendResponse({ ok: false, error: { type: "server", message: msg2, retryable: true } });
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
