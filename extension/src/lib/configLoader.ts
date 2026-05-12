/**
 * configLoader.ts
 *
 * Loads + validates the single Drive-hosted `jobhelp-config.json`
 * (Approach C from docs/superpowers/plans/2026-05-10-future-setup-simplification.md).
 *
 * Flow:
 *   1. Caller passes the Drive file id of `jobhelp-config.json` and an ApiClient
 *      (the same client used by the rest of the extension).
 *   2. We call `apiClient.downloadTemplate({ fileId })` to fetch the file as
 *      base64 (reusing the existing Drive-download path — no new transport).
 *   3. atob() the base64, parse as JSON, validate the schema.
 *   4. Cache the parsed config in memory for the rest of the session.
 *
 * This module is scaffolding only — nothing in the app calls it yet. Wiring
 * into settings.ts / sidepanel/index.ts is a follow-up milestone.
 */

import type { ApiClient } from "./apiClient.js";
import type {
  JobhelpConfig,
  JobhelpDefaults,
  JobhelpFolders,
  JobhelpPreferences,
} from "../types/jobhelp-config.js";
import { ConfigValidationError } from "../types/jobhelp-config.js";
import { log } from "./structuredLog.js";

/** Plausible Anthropic API key shape — used only for a non-fatal sanity log. */
const ANTHROPIC_KEY_PREFIX_RE = /^sk-ant-/;

/** In-memory session cache: fileId -> parsed config. */
const cache = new Map<string, JobhelpConfig>();

/**
 * Clear the in-memory config cache. Intended for tests and the "Reload config"
 * button in the Settings tab (future milestone).
 */
export function clearConfigCache(): void {
  cache.clear();
}

/**
 * Decode a base64 string to UTF-8 text.
 *
 * Uses `atob` (available in both browser and Node 16+/jsdom test envs). We
 * deliberately avoid a Buffer-based path so this works unmodified in the
 * Chrome extension context.
 */
function decodeBase64ToUtf8(b64: string): string {
  // atob returns a "binary string" — one char per byte. To handle multi-byte
  // UTF-8 we map each char to its byte value and decode via TextDecoder.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Type-guard: value is a non-null plain object (not array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Assert a value is a non-empty string at `path`, else throw. */
function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new ConfigValidationError(
      `Config field "${path}" must be a string (got ${describeType(v)}).`,
      path,
    );
  }
  if (v.length === 0) {
    throw new ConfigValidationError(
      `Config field "${path}" must not be empty.`,
      path,
    );
  }
  return v;
}

/** Assert a value is a boolean at `path`, else throw. */
function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") {
    throw new ConfigValidationError(
      `Config field "${path}" must be a boolean (got ${describeType(v)}).`,
      path,
    );
  }
  return v;
}

/** Assert a value is a nested object at `path`, else throw. */
function requireObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const v = obj[key];
  if (!isPlainObject(v)) {
    throw new ConfigValidationError(
      `Config field "${path}" must be an object (got ${describeType(v)}).`,
      path,
    );
  }
  return v;
}

/** Best-effort type label for error messages — keeps null/array distinct. */
function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (v === undefined) return "missing";
  return typeof v;
}

/**
 * Validate a parsed JSON value against the JobhelpConfig schema. On success
 * returns a fully-typed JobhelpConfig; on failure throws ConfigValidationError.
 */
function validateConfig(parsed: unknown): JobhelpConfig {
  if (!isPlainObject(parsed)) {
    throw new ConfigValidationError(
      `Config root must be a JSON object (got ${describeType(parsed)}).`,
      null,
    );
  }

  const anthropicApiKey = requireString(parsed, "anthropicApiKey", "anthropicApiKey");
  // Non-fatal: a plausible-but-typoed key (e.g. "sk-ANT-…") passes the
  // string check but only fails on the first Claude call. Flag it now so the
  // failure is at least diagnosable upfront (audit M24). The value itself is
  // redacted by the logger.
  if (!ANTHROPIC_KEY_PREFIX_RE.test(anthropicApiKey)) {
    log("warn", "configLoader: anthropicApiKey does not start with 'sk-ant-' — likely a typo", {
      anthropicApiKey,
    });
  }
  const appsScriptUrl = requireString(parsed, "appsScriptUrl", "appsScriptUrl");

  const foldersRaw = requireObject(parsed, "folders", "folders");
  const folders: JobhelpFolders = {
    source: requireString(foldersRaw, "source", "folders.source"),
    rules: requireString(foldersRaw, "rules", "folders.rules"),
    output: requireString(foldersRaw, "output", "folders.output"),
  };

  const sheetId = requireString(parsed, "sheetId", "sheetId");
  const templateDocxId = requireString(parsed, "templateDocxId", "templateDocxId");

  const defaultsRaw = requireObject(parsed, "defaults", "defaults");
  const defaults: JobhelpDefaults = {
    model: requireString(defaultsRaw, "model", "defaults.model"),
    togglePreset: requireString(defaultsRaw, "togglePreset", "defaults.togglePreset"),
  };

  const preferencesRaw = requireObject(parsed, "preferences", "preferences");
  const preferences: JobhelpPreferences = {
    autoConvertOnGenerate: requireBoolean(
      preferencesRaw,
      "autoConvertOnGenerate",
      "preferences.autoConvertOnGenerate",
    ),
    showCostInline: requireBoolean(
      preferencesRaw,
      "showCostInline",
      "preferences.showCostInline",
    ),
  };

  return {
    anthropicApiKey,
    appsScriptUrl,
    folders,
    sheetId,
    templateDocxId,
    defaults,
    preferences,
  };
}

/**
 * Fetch `jobhelp-config.json` from Drive, validate it, and return the typed
 * config. Subsequent calls with the same fileId return the cached value
 * (clear with `clearConfigCache()`).
 *
 * Errors:
 *   - apiClient.downloadTemplate transport / Drive failure → re-thrown as
 *     a plain `Error` (caller can inspect `err.message`).
 *   - Base64 decode or JSON parse failure → `ConfigValidationError`
 *     (field === null).
 *   - Schema mismatch (missing key, wrong type) → `ConfigValidationError`
 *     with `field` set to the offending dotted path.
 */
export async function loadConfigFromDrive(
  fileId: string,
  apiClient: ApiClient,
): Promise<JobhelpConfig> {
  const cached = cache.get(fileId);
  if (cached !== undefined) {
    return cached;
  }

  const response = await apiClient.downloadTemplate({ fileId });
  if (!response.ok) {
    // Propagate the underlying transport / Drive error as a plain Error so
    // callers can distinguish it from ConfigValidationError via instanceof.
    // We preserve the original error type in the message AND log it so the
    // type ('validation' | 'drive' | 'server') isn't entirely lost (audit
    // M12 — a fully typed ConfigDownloadError would need a new exported type).
    log("warn", "configLoader: download of jobhelp-config.json failed", {
      fileId,
      errorType: response.error.type,
      error: response.error.message,
      retryable: response.error.retryable,
    });
    throw new Error(
      `Failed to download jobhelp-config.json (fileId=${fileId}): [${response.error.type}] ${response.error.message}`,
    );
  }

  let jsonText: string;
  try {
    jsonText = decodeBase64ToUtf8(response.base64);
  } catch (err) {
    log("warn", "configLoader: base64 decode of jobhelp-config.json failed", {
      fileId,
      error: (err as Error)?.message ?? "unknown error",
    });
    throw new ConfigValidationError(
      `Could not base64-decode config file: ${(err as Error)?.message ?? "unknown error"}`,
      null,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    // A common cause: the bytes weren't actually UTF-8 JSON (binary file id,
    // wrong file shared, etc.). TextDecoder replaces invalid bytes with U+FFFD
    // rather than throwing, so the failure surfaces here as "not valid JSON".
    log("warn", "configLoader: jobhelp-config.json is not valid JSON", {
      fileId,
      error: (err as Error)?.message ?? "unknown error",
      contentSnippet: jsonText.slice(0, 200),
    });
    throw new ConfigValidationError(
      `Config file is not valid JSON: ${(err as Error)?.message ?? "unknown error"}`,
      null,
    );
  }

  const config = validateConfig(parsed);
  cache.set(fileId, config);
  return config;
}
