/**
 * onboarding-wizard.ts
 *
 * First-run setup wizard rendered as a modal overlay over the Settings tab.
 *
 * Walks the user through four steps:
 *   1. Welcome — explain Approach C (one Drive-hosted JSON config file).
 *   2. Create — create a fresh `jobhelp-config.json` in Drive via
 *      `apiClient.createDriveFile` (if D1's action is available). The button
 *      is disabled with a tooltip if the API method isn't wired yet.
 *   3. Open  — show the new file's URL so the user can fill in real values.
 *   4. Validate — paste the file id back, click Validate, run
 *      `loadConfigFromDrive` to confirm the JSON parses + matches the schema.
 *      On success, persist the id to `chrome.storage.local.jobhelpConfigFileId`
 *      and close the wizard.
 *
 * The wizard is pure DOM — no framework. It returns a controller with a
 * `root` element (overlay div) and `close()` / `open(step?)` methods.
 *
 * D1 dependency note: `apiClient.createDriveFile` is referenced at runtime
 * only — never at module load. We check `typeof apiClient.createDriveFile ===
 * "function"` before calling so the build stays clean when D1 hasn't landed.
 */

import { ApiClient } from "../lib/apiClient.js";
import { loadConfigFromDrive, clearConfigCache } from "../lib/configLoader.js";
import { ConfigValidationError } from "../types/jobhelp-config.js";
import { set, get } from "../lib/storage.js";
import type { JobhelpConfig } from "../types/jobhelp-config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of the optional `createDriveFile` method on ApiClient (D1 territory).
 *  Declared locally so we don't take a load-time dependency on D1's types. */
export interface CreateDriveFileArgs {
  fileName: string;
  content: string;
  mimeType?: string;
  parentFolderId?: string;
}
export type CreateDriveFileResponse =
  | { ok: true; fileId: string; fileUrl: string }
  | { ok: false; error: { type: string; message: string; retryable: boolean } };

/** Optional method-augmentation: ApiClient may expose `createDriveFile`. */
interface MaybeCreateDriveFile {
  createDriveFile?: (args: CreateDriveFileArgs) => Promise<CreateDriveFileResponse>;
}

/** Controller returned by `renderOnboardingWizard`. */
export interface OnboardingWizardController {
  /** Overlay element. Append to document.body once; toggle visibility via open/close. */
  root: HTMLElement;
  /** Open the wizard (optionally jumping to a specific step). */
  open(step?: 1 | 2 | 3 | 4): void;
  /** Close the wizard without persisting anything. */
  close(): void;
  /**
   * Whether the wizard finished successfully (config validated + saved).
   * Read after close() to decide whether to refresh the Settings tab.
   */
  completed(): boolean;
}

export interface OnboardingWizardHooks {
  /** Optional. If omitted, the wizard tries to build one from chrome.storage.local.appsScriptUrl. */
  apiClient?: ApiClient;
  /** Called after the user successfully validates a config file id. */
  onComplete?: (fileId: string, config: JobhelpConfig) => void;
  /** Called when the wizard is dismissed (Cancel or backdrop). */
  onClose?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template JSON written into the new Drive file in step 2.
// Values are placeholders so the user knows where to paste real data.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_TEMPLATE = {
  // JobHelp config — paste your secrets / IDs in below, then save in Drive.
  // The Chrome extension reads this file on side-panel open. Never check
  // this file into version control; it's meant to live in YOUR Drive only.
  anthropicApiKey: "<paste your anthropic api key>",
  appsScriptUrl: "<paste your apps script /exec url>",
  folders: {
    source: "<paste your source-materials folder id>",
    rules: "<paste your rules folder id>",
    output: "<paste your output folder id>",
  },
  sheetId: "<paste your tracking sheet id>",
  templateDocxId: "<paste your resume-template docx file id>",
  defaults: {
    model: "claude-haiku-4-5-20251001",
    togglePreset: "Quick",
  },
  preferences: {
    autoConvertOnGenerate: false,
    showCostInline: true,
  },
} as const;

/** Pretty-printed JSON for the new config file's initial contents. */
export function buildConfigTemplateJson(): string {
  return JSON.stringify(CONFIG_TEMPLATE, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

export function renderOnboardingWizard(
  hooks: OnboardingWizardHooks = {},
): OnboardingWizardController {
  let currentStep: 1 | 2 | 3 | 4 = 1;
  let createdFileId: string | null = null;
  let createdFileUrl: string | null = null;
  let didComplete = false;

  // ── Overlay shell ─────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "wizard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "JobHelp onboarding");
  overlay.style.display = "none";
  overlay.addEventListener("click", (e) => {
    // Backdrop click closes; click inside the dialog does not.
    if (e.target === overlay) close();
  });

  const dialog = document.createElement("div");
  dialog.className = "wizard-dialog";
  overlay.appendChild(dialog);

  const header = document.createElement("div");
  header.className = "wizard-header";

  const title = document.createElement("h2");
  title.className = "wizard-title";
  title.textContent = "Welcome to JobHelp";
  header.appendChild(title);

  const stepIndicator = document.createElement("div");
  stepIndicator.className = "wizard-step-indicator";
  stepIndicator.setAttribute("aria-live", "polite");
  header.appendChild(stepIndicator);

  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "wizard-body";
  dialog.appendChild(body);

  const status = document.createElement("div");
  status.className = "wizard-status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-wizard-status", "");
  dialog.appendChild(status);

  const footer = document.createElement("div");
  footer.className = "wizard-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary wizard-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(cancelBtn);

  dialog.appendChild(footer);

  // ── Step renderers (one builder per step; rebuilt on transition) ───────────

  function renderStep(): void {
    stepIndicator.textContent = `Step ${currentStep} of 4`;
    body.replaceChildren();
    status.textContent = "";
    status.className = "wizard-status";

    if (currentStep === 1) renderStep1();
    else if (currentStep === 2) renderStep2();
    else if (currentStep === 3) renderStep3();
    else renderStep4();
  }

  function renderStep1(): void {
    title.textContent = "Welcome to JobHelp";
    const p = document.createElement("p");
    p.className = "wizard-paragraph";
    p.textContent =
      "JobHelp keeps all of its setup (API key, Drive folder IDs, sheet ID, " +
      "default model, etc.) in a single JSON file in your own Google Drive. " +
      "This wizard will create that file, ask you to fill it in, and then " +
      "remember only the file's ID — so you can re-install the extension on " +
      "any machine and re-link in one paste.";
    body.appendChild(p);

    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-primary wizard-next";
    next.textContent = "Get started";
    next.addEventListener("click", () => goTo(2));
    body.appendChild(next);
  }

  function renderStep2(): void {
    title.textContent = "Create JobHelp config file";
    const p = document.createElement("p");
    p.className = "wizard-paragraph";
    p.textContent =
      "Click below to create a new file named jobhelp-config.json in your " +
      "Drive. It will be pre-populated with placeholder values you'll fill " +
      "in next.";
    body.appendChild(p);

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "btn btn-primary wizard-create";
    createBtn.textContent = "Create config";

    const apiClient = hooks.apiClient;
    const augmented = apiClient as (ApiClient & MaybeCreateDriveFile) | undefined;
    const canCreate =
      !!augmented && typeof augmented.createDriveFile === "function";

    if (!canCreate) {
      createBtn.disabled = true;
      createBtn.title =
        "Drive-file creation is not available yet. Update the Apps Script " +
        "backend (action: create_drive_file), or paste an existing file ID " +
        "into Settings instead.";
    }

    createBtn.addEventListener("click", () => {
      if (!canCreate) return;
      void (async () => {
        createBtn.disabled = true;
        createBtn.textContent = "Creating…";
        try {
          // We have already guard-checked the method above.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const fn = augmented!.createDriveFile!;
          const resp = await fn({
            fileName: "jobhelp-config.json",
            content: buildConfigTemplateJson(),
            mimeType: "application/json",
          });
          if (!resp.ok) {
            setStatus("error", `Could not create file: ${resp.error.message}`);
            createBtn.disabled = false;
            createBtn.textContent = "Try again";
            return;
          }
          createdFileId = resp.fileId;
          createdFileUrl = resp.fileUrl;
          setStatus("success", `Created config file (id: ${resp.fileId}).`);
          goTo(3);
        } catch (err) {
          const msg = (err as Error)?.message ?? "Unknown error";
          setStatus("error", `Create failed: ${msg}`);
          createBtn.disabled = false;
          createBtn.textContent = "Try again";
        }
      })();
    });

    body.appendChild(createBtn);

    // Always offer a "skip to step 4 and paste an id" escape hatch — useful
    // when the user already has a config file from a previous install.
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn btn-secondary wizard-skip";
    skipBtn.textContent = "I already have a config file";
    skipBtn.addEventListener("click", () => goTo(4));
    body.appendChild(skipBtn);
  }

  function renderStep3(): void {
    title.textContent = "Open the file and fill in your values";
    const p = document.createElement("p");
    p.className = "wizard-paragraph";
    p.textContent =
      "Open the file in Drive, replace every <paste …> placeholder with " +
      "your real Anthropic key / folder IDs / sheet ID, then click Continue " +
      "below.";
    body.appendChild(p);

    if (createdFileUrl) {
      const link = document.createElement("a");
      link.className = "btn btn-primary wizard-open-link";
      link.href = createdFileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open in Drive — fill in the values";
      body.appendChild(link);
    } else {
      const warn = document.createElement("div");
      warn.className = "wizard-warning";
      warn.textContent =
        "No file URL captured. You may need to find the file manually in Drive.";
      body.appendChild(warn);
    }

    const cont = document.createElement("button");
    cont.type = "button";
    cont.className = "btn btn-secondary wizard-continue";
    cont.textContent = "I'm done filling it in";
    cont.addEventListener("click", () => goTo(4));
    body.appendChild(cont);
  }

  function renderStep4(): void {
    title.textContent = "Validate your config";
    const p = document.createElement("p");
    p.className = "wizard-paragraph";
    p.textContent =
      "Paste (or confirm) the file ID below and click Validate. We'll load " +
      "the file from Drive and check that every required field is filled in.";
    body.appendChild(p);

    const row = document.createElement("div");
    row.className = "wizard-row";

    const label = document.createElement("label");
    label.className = "wizard-label";
    label.textContent = "JobHelp config file ID";
    label.setAttribute("for", "wizard-file-id");
    row.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.id = "wizard-file-id";
    input.className = "wizard-input";
    input.setAttribute("data-wizard-file-id", "");
    input.placeholder = "1AbCdEf… (Drive file id)";
    if (createdFileId) input.value = createdFileId;
    row.appendChild(input);

    body.appendChild(row);

    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    validateBtn.className = "btn btn-primary wizard-validate";
    validateBtn.textContent = "Validate";
    validateBtn.addEventListener("click", () => {
      void (async () => {
        const fileId = input.value.trim();
        if (!fileId) {
          setStatus("error", "Paste a Drive file id first.");
          return;
        }
        const client = await resolveApiClient(hooks);
        if (!client) {
          setStatus(
            "error",
            "Apps Script URL not configured. Add it to Settings first, then re-run onboarding.",
          );
          return;
        }
        validateBtn.disabled = true;
        validateBtn.textContent = "Checking…";
        try {
          clearConfigCache();
          const config = await loadConfigFromDrive(fileId, client);
          await set("jobhelpConfigFileId", fileId);
          setStatus("success", "Config validated! Closing setup…");
          didComplete = true;
          hooks.onComplete?.(fileId, config);
          // Brief delay so the user sees the success state.
          setTimeout(() => close(), 600);
        } catch (err) {
          if (err instanceof ConfigValidationError) {
            const where = err.field ? ` (field: ${err.field})` : "";
            setStatus("error", `${err.message}${where}`);
          } else {
            const msg = (err as Error)?.message ?? "Unknown error";
            setStatus("error", `Validation failed: ${msg}`);
          }
          validateBtn.disabled = false;
          validateBtn.textContent = "Validate";
        }
      })();
    });
    body.appendChild(validateBtn);
  }

  function setStatus(kind: "success" | "error" | "info", msg: string): void {
    status.textContent = msg;
    status.className = `wizard-status wizard-status--${kind}`;
  }

  function goTo(step: 1 | 2 | 3 | 4): void {
    currentStep = step;
    renderStep();
  }

  function open(step?: 1 | 2 | 3 | 4): void {
    didComplete = false;
    currentStep = step ?? 1;
    overlay.style.display = "flex";
    renderStep();
  }

  function close(): void {
    overlay.style.display = "none";
    hooks.onClose?.();
  }

  // Initial render is deferred until open() — keep the DOM cheap when hidden.

  return {
    root: overlay,
    open,
    close,
    completed: () => didComplete,
  };
}

/**
 * Best-effort: prefer the caller-supplied ApiClient; else try to build one
 * from `chrome.storage.local.appsScriptUrl`. Returns null if neither path
 * yields a URL.
 */
async function resolveApiClient(
  hooks: OnboardingWizardHooks,
): Promise<ApiClient | null> {
  if (hooks.apiClient) return hooks.apiClient;
  try {
    const url = await get("appsScriptUrl");
    if (url) return new ApiClient(url);
  } catch {
    // ignore; fall through
  }
  return null;
}
