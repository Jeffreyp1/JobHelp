/**
 * Settings tab (v2.1 — Approach C, single Drive-hosted config file).
 *
 * Replaces the eight per-machine input fields with a single "JobHelp config
 * file ID" paste-target. The actual configuration values live in a JSON file
 * in the user's own Drive; this extension only remembers the *file id* to
 * bootstrap on any machine.
 *
 * Surfaced UI:
 *   - "JobHelp config file ID" text input (persists to `jobhelpConfigFileId`)
 *   - Reload config — clears the in-memory cache and re-fetches from Drive
 *   - Open config in Drive — opens https://drive.google.com/file/d/{id}/edit
 *   - Migrate from local settings — visible iff any of the 8 legacy keys are
 *     populated; bundles them into a JobhelpConfig and (if D1 has shipped
 *     `apiClient.createDriveFile`) writes a new Drive file. Disabled with a
 *     tooltip when the action isn't available.
 *   - Run onboarding — opens the wizard overlay (rendered into the section).
 *   - Diagnostic readout — shows the loaded config values with the API key
 *     masked (`sk-ant-…XXXX`) and everything else in clear text.
 */

import { get, set } from "../../lib/storage.js";
import { LEGACY_SETTINGS_KEYS } from "../../types/storage-schema.js";
import { ApiClient } from "../../lib/apiClient.js";
import {
  loadConfigFromDrive,
  clearConfigCache,
} from "../../lib/configLoader.js";
import { ConfigValidationError } from "../../types/jobhelp-config.js";
import type { JobhelpConfig } from "../../types/jobhelp-config.js";
import { renderOnboardingWizard } from "../onboarding-wizard.js";
import type { OnboardingWizardController } from "../onboarding-wizard.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Optional augmentation: ApiClient may expose `createDriveFile` (D1). */
interface MaybeCreateDriveFile {
  createDriveFile?: (args: {
    fileName: string;
    content: string;
    mimeType?: string;
    parentFolderId?: string;
  }) => Promise<
    | { ok: true; fileId: string; fileUrl: string }
    | { ok: false; error: { type: string; message: string; retryable: boolean } }
  >;
}

export interface SettingsTabHooks {
  /** Optional override — defaults to a client built from the loaded config or legacy URL. */
  apiClient?: ApiClient;
  /** Called whenever a valid config is loaded (so index.ts can cache it). */
  onConfigLoaded?: (config: JobhelpConfig, fileId: string) => void;
  /** Whether the wizard should auto-open after mount (first-run flow). */
  autoOpenWizard?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public mask helper — exported for tests.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mask an Anthropic API key for diagnostic display. Returns `sk-ant-…XXXX`
 * where XXXX is the last 4 chars, or `sk-ant-…` if the key is too short.
 * Returns an empty string for missing input.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 4) return "sk-ant-…";
  const last4 = key.slice(-4);
  return `sk-ant-…${last4}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

export function renderSettingsTab(hooks: SettingsTabHooks = {}): HTMLElement {
  const root = document.createElement("section");
  root.className = "tab-pane tab-pane--settings";

  const heading = document.createElement("h2");
  heading.className = "settings__title";
  heading.textContent = "Settings";
  root.appendChild(heading);

  const intro = document.createElement("p");
  intro.className = "settings__intro";
  intro.textContent =
    "JobHelp now keeps your full setup (API key, Drive folder IDs, sheet " +
    "ID, default model) in a single jobhelp-config.json file in your own " +
    "Drive. Paste the Drive file ID below to link this extension to your " +
    "config.";
  root.appendChild(intro);

  // ── File-ID input ─────────────────────────────────────────────────────────
  const fileIdRow = document.createElement("div");
  fileIdRow.className = "settings-row";

  const fileIdLabel = document.createElement("label");
  fileIdLabel.className = "settings-row__label";
  fileIdLabel.textContent = "JobHelp config file ID";
  fileIdLabel.setAttribute("for", "settings-jobhelp-config-file-id");
  fileIdRow.appendChild(fileIdLabel);

  const fileIdInput = document.createElement("input");
  fileIdInput.id = "settings-jobhelp-config-file-id";
  fileIdInput.className = "settings-row__input";
  fileIdInput.type = "text";
  fileIdInput.placeholder = "1AbCdEf… (Drive file id)";
  fileIdInput.setAttribute("data-settings-file-id", "");
  fileIdRow.appendChild(fileIdInput);

  const fileIdHelp = document.createElement("div");
  fileIdHelp.className = "settings-row__help";
  fileIdHelp.textContent =
    "Find this in the file's Drive URL: https://drive.google.com/file/d/" +
    "{ID}/edit — paste the bit between /d/ and /edit.";
  fileIdRow.appendChild(fileIdHelp);

  root.appendChild(fileIdRow);

  fileIdInput.addEventListener("change", () => {
    void set("jobhelpConfigFileId", fileIdInput.value.trim() || null);
  });

  // Hydrate from storage.
  void (async () => {
    try {
      const stored = await get("jobhelpConfigFileId");
      if (stored) fileIdInput.value = stored;
    } catch {
      // ignore
    }
  })();

  // ── Status banner (shared between Reload + Migrate) ───────────────────────
  const status = document.createElement("div");
  status.className = "settings__status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-settings-status", "");
  root.appendChild(status);

  function setStatus(kind: "success" | "error" | "info", msg: string): void {
    status.textContent = msg;
    status.className = `settings__status settings__status--${kind}`;
  }

  // ── Diagnostic readout (filled in after a successful load) ────────────────
  const diag = document.createElement("div");
  diag.className = "settings__diagnostic";
  diag.setAttribute("data-settings-diagnostic", "");
  root.appendChild(diag);

  function renderDiagnostic(config: JobhelpConfig | null): void {
    diag.replaceChildren();
    if (!config) {
      const empty = document.createElement("div");
      empty.className = "settings__diagnostic-empty";
      empty.textContent = "No config loaded yet. Paste a file ID and click Reload.";
      diag.appendChild(empty);
      return;
    }
    const title = document.createElement("h3");
    title.className = "settings__diagnostic-title";
    title.textContent = "Loaded config";
    diag.appendChild(title);

    const rows: Array<[string, string]> = [
      ["Anthropic API key", maskApiKey(config.anthropicApiKey)],
      ["Apps Script URL", config.appsScriptUrl],
      ["Source folder ID", config.folders.source],
      ["Rules folder ID", config.folders.rules],
      ["Output folder ID", config.folders.output],
      ["Tracking sheet ID", config.sheetId],
      ["Template DOCX ID", config.templateDocxId],
      ["Default model", config.defaults.model],
      ["Default preset", config.defaults.togglePreset],
      [
        "Auto-convert on generate",
        config.preferences.autoConvertOnGenerate ? "yes" : "no",
      ],
      [
        "Show cost inline",
        config.preferences.showCostInline ? "yes" : "no",
      ],
    ];

    const dl = document.createElement("dl");
    dl.className = "settings__diagnostic-list";
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.className = "settings__diagnostic-key";
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.className = "settings__diagnostic-value";
      dd.textContent = v || "—";
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    diag.appendChild(dl);
  }

  renderDiagnostic(null);

  // ── Actions row ────────────────────────────────────────────────────────────
  const actions = document.createElement("div");
  actions.className = "settings__actions";

  // Reload config
  const reloadBtn = makeButton("Reload config", "btn-primary", async () => {
    const fileId = fileIdInput.value.trim();
    if (!fileId) {
      setStatus("error", "Paste a JobHelp config file ID first.");
      return;
    }
    reloadBtn.disabled = true;
    const prevLabel = reloadBtn.textContent;
    reloadBtn.textContent = "Loading…";
    try {
      const client = await resolveApiClient(hooks);
      if (!client) {
        setStatus(
          "error",
          "Apps Script URL not available — paste it inside your config file first.",
        );
        return;
      }
      clearConfigCache();
      const config = await loadConfigFromDrive(fileId, client);
      await set("jobhelpConfigFileId", fileId);
      setStatus("success", "Config loaded successfully.");
      renderDiagnostic(config);
      hooks.onConfigLoaded?.(config, fileId);
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        const where = err.field ? ` (field: ${err.field})` : "";
        setStatus("error", `${err.message}${where}`);
      } else {
        const msg = (err as Error)?.message ?? "Unknown error";
        setStatus("error", `Reload failed: ${msg}`);
      }
    } finally {
      reloadBtn.disabled = false;
      reloadBtn.textContent = prevLabel ?? "Reload config";
    }
  });
  actions.appendChild(reloadBtn);

  // Open config in Drive
  actions.appendChild(
    makeButton("Open config in Drive", "btn-secondary", async () => {
      const fileId = fileIdInput.value.trim();
      if (!fileId) {
        setStatus("error", "Paste a JobHelp config file ID first.");
        return;
      }
      window.open(`https://drive.google.com/file/d/${fileId}/edit`, "_blank");
    }),
  );

  // Run onboarding (re-opens the wizard)
  const runOnboardingBtn = makeButton(
    "Run onboarding",
    "btn-secondary",
    () => {
      wizard.open(1);
    },
  );
  actions.appendChild(runOnboardingBtn);

  // Migrate from local settings — visibility depends on legacy storage
  const migrateBtn = makeButton(
    "Migrate from local settings",
    "btn-secondary",
    async () => {
      await runMigration({
        hooks,
        setStatus,
        onComplete: (newFileId, config) => {
          fileIdInput.value = newFileId;
          renderDiagnostic(config);
          hooks.onConfigLoaded?.(config, newFileId);
        },
      });
    },
  );
  migrateBtn.style.display = "none";
  migrateBtn.setAttribute("data-settings-migrate", "");
  actions.appendChild(migrateBtn);

  root.appendChild(actions);

  // Show / hide the Migrate button based on whether any legacy key is set.
  void (async () => {
    try {
      const populated = await anyLegacyPopulated();
      migrateBtn.style.display = populated ? "" : "none";
    } catch {
      // ignore
    }
  })();

  // ── Wizard overlay (rendered into the section; toggled via .open()) ───────
  const wizard: OnboardingWizardController = renderOnboardingWizard({
    apiClient: hooks.apiClient,
    onComplete: (fileId, config) => {
      fileIdInput.value = fileId;
      renderDiagnostic(config);
      setStatus("success", "Setup complete — config is now linked.");
      hooks.onConfigLoaded?.(config, fileId);
    },
  });
  root.appendChild(wizard.root);

  if (hooks.autoOpenWizard) {
    // Defer to next tick so callers can append the root before the overlay shows.
    setTimeout(() => wizard.open(1), 0);
  }

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an ApiClient to use for config loading / migration. Preference
 * order:
 *   1. Caller-supplied hooks.apiClient
 *   2. `appsScriptUrl` legacy storage key (so migration works even before
 *      the user pastes a config file id).
 */
async function resolveApiClient(
  hooks: SettingsTabHooks,
): Promise<ApiClient | null> {
  if (hooks.apiClient) return hooks.apiClient;
  try {
    const url = await get("appsScriptUrl");
    if (url) return new ApiClient(url);
  } catch {
    // ignore
  }
  return null;
}

/**
 * True iff any of the 8 deprecated v2.0 settings keys hold a non-empty value
 * in `chrome.storage.local`. We bypass the typed `get()` wrapper here on
 * purpose: `get()` returns `STORAGE_DEFAULTS` for absent keys, and one of
 * the legacy keys (`defaultGenerateModel`) has a non-empty default — which
 * would otherwise flip migration on for fresh installs that have never
 * touched the legacy form.
 */
async function anyLegacyPopulated(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  if (!c?.storage?.local) return false;
  try {
    const result = (await c.storage.local.get(
      LEGACY_SETTINGS_KEYS as readonly string[],
    )) as Record<string, unknown>;
    for (const key of LEGACY_SETTINGS_KEYS) {
      const v = result[key];
      if (typeof v === "string" && v.trim().length > 0) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Build a JobhelpConfig JSON from the 8 legacy storage keys and (if
 * `apiClient.createDriveFile` is available) write it to Drive. Reports
 * progress via `setStatus` and invokes `onComplete` with the new file id.
 */
async function runMigration(args: {
  hooks: SettingsTabHooks;
  setStatus: (kind: "success" | "error" | "info", msg: string) => void;
  onComplete: (fileId: string, config: JobhelpConfig) => void;
}): Promise<void> {
  const { hooks, setStatus, onComplete } = args;

  setStatus("info", "Reading legacy settings…");

  const [
    anthropicApiKey,
    appsScriptUrl,
    source,
    rules,
    output,
    templateDocxId,
    sheetId,
    defaultModel,
  ] = await Promise.all([
    get("anthropicApiKey"),
    get("appsScriptUrl"),
    get("driveSourceFolderId"),
    get("driveRulesFolderId"),
    get("driveOutputFolderId"),
    get("driveTemplateDocxId"),
    get("sheetId"),
    get("defaultGenerateModel"),
  ]);

  const config: JobhelpConfig = {
    anthropicApiKey: anthropicApiKey ?? "",
    appsScriptUrl: appsScriptUrl ?? "",
    folders: {
      source: source ?? "",
      rules: rules ?? "",
      output: output ?? "",
    },
    sheetId: sheetId ?? "",
    templateDocxId: templateDocxId ?? "",
    defaults: {
      model: defaultModel || "claude-haiku-4-5-20251001",
      togglePreset: "Quick",
    },
    preferences: {
      autoConvertOnGenerate: false,
      showCostInline: true,
    },
  };

  const client = (await resolveApiClient(hooks)) as
    | (ApiClient & MaybeCreateDriveFile)
    | null;

  if (!client) {
    setStatus(
      "error",
      "No Apps Script URL available — cannot create the new config file.",
    );
    return;
  }

  if (typeof client.createDriveFile !== "function") {
    setStatus(
      "error",
      "The backend doesn't yet support creating Drive files (action: " +
        "create_drive_file). Update Apps Script, then retry migration.",
    );
    return;
  }

  setStatus("info", "Uploading new jobhelp-config.json to Drive…");
  try {
    const resp = await client.createDriveFile({
      fileName: "jobhelp-config.json",
      content: JSON.stringify(config, null, 2),
      mimeType: "application/json",
    });
    if (!resp.ok) {
      setStatus("error", `Migration failed: ${resp.error.message}`);
      return;
    }
    await set("jobhelpConfigFileId", resp.fileId);
    setStatus(
      "success",
      `Migration complete. New config file id: ${resp.fileId}.`,
    );
    onComplete(resp.fileId, config);
  } catch (err) {
    const msg = (err as Error)?.message ?? "Unknown error";
    setStatus("error", `Migration failed: ${msg}`);
  }
}

function makeButton(
  label: string,
  variant: string,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn ${variant}`;
  btn.textContent = label;
  btn.addEventListener("click", () => {
    void onClick();
  });
  return btn;
}
