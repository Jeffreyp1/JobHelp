/**
 * configMigration.ts
 *
 * One-shot migration helper for v2.0 → v2.1 setup-simplification
 * (Approach C from docs/superpowers/plans/2026-05-10-future-setup-simplification.md).
 *
 * v2.0 stored 8 "settings" values directly in chrome.storage.local:
 *   - anthropicApiKey
 *   - appsScriptUrl
 *   - driveSourceFolderId / driveRulesFolderId / driveOutputFolderId
 *   - driveTemplateDocxId
 *   - sheetId
 *   - defaultGenerateModel
 *
 * v2.1 consolidates those into a single `jobhelp-config.json` file in the
 * user's Drive and only remembers the *file id* of that config locally
 * (`jobhelpConfigFileId`).
 *
 * This module bridges the two:
 *   1. {@link hasLegacySettings} — returns true if any of the 8 deprecated
 *      keys are populated (used by settings.ts to decide whether to offer
 *      "Migrate from v2.0" UI).
 *   2. {@link buildConfigFromLegacy} — reads all 8 deprecated keys and
 *      returns a JobhelpConfig object (or an error if anthropicApiKey or
 *      appsScriptUrl is missing — those are required and have no default).
 *   3. {@link clearLegacySettings} — removes the 8 deprecated keys.
 *      MUST only be called AFTER the user confirms migration succeeded
 *      (i.e. the new Drive config file was created and `jobhelpConfigFileId`
 *      was saved).
 *
 * Integration point (deferred to D2): `extension-app/extension/src/sidepanel/tabs/settings.ts`
 * calls `hasLegacySettings()` on tab open; if true, shows a "Migrate" button
 * that wires through `buildConfigFromLegacy()` → upload to Drive →
 * `clearLegacySettings()`.
 */

import * as storage from "./storage.js";
import type { JobhelpConfig } from "../types/jobhelp-config.js";
import {
  LEGACY_SETTINGS_KEYS,
  type LegacySettingsKey,
} from "../types/storage-schema.js";

/** Defaults applied when an optional field is missing during migration. */
const MIGRATION_DEFAULTS = {
  defaultGenerateModel: "claude-haiku-4-5-20251001",
  togglePreset: "Quick",
  autoConvertOnGenerate: false,
  showCostInline: true,
} as const;

/**
 * Returns true if any of the 8 deprecated v2.0 settings keys are populated
 * in chrome.storage.local. A "populated" string-like value means a non-null,
 * non-empty value; `defaultGenerateModel` is treated as populated only if
 * the stored value differs from the schema default (otherwise the schema
 * default itself would always mark legacy state as present).
 */
export async function hasLegacySettings(): Promise<boolean> {
  for (const key of LEGACY_SETTINGS_KEYS) {
    const value = await storage.get(key);
    if (isPopulated(key, value)) {
      return true;
    }
  }
  return false;
}

/**
 * Read all 8 deprecated keys and build a JobhelpConfig. Returns `{ error }`
 * when a required field (anthropicApiKey or appsScriptUrl) is missing —
 * those values have no sensible default. All other missing fields fall back
 * to their migration default or an empty string.
 *
 * Note: this function does NOT clear the legacy keys; call
 * {@link clearLegacySettings} only after the resulting config has been
 * successfully uploaded to Drive AND `jobhelpConfigFileId` has been saved.
 */
export async function buildConfigFromLegacy(): Promise<
  JobhelpConfig | { error: string }
> {
  const anthropicApiKey = await storage.get("anthropicApiKey");
  const appsScriptUrl = await storage.get("appsScriptUrl");

  if (!anthropicApiKey || anthropicApiKey.length === 0) {
    return {
      error:
        "Cannot migrate: anthropicApiKey is missing. Re-enter it in Settings and try again.",
    };
  }
  if (!appsScriptUrl || appsScriptUrl.length === 0) {
    return {
      error:
        "Cannot migrate: appsScriptUrl is missing. Re-enter it in Settings and try again.",
    };
  }

  const driveSourceFolderId = (await storage.get("driveSourceFolderId")) ?? "";
  const driveRulesFolderId = (await storage.get("driveRulesFolderId")) ?? "";
  const driveOutputFolderId = (await storage.get("driveOutputFolderId")) ?? "";
  const sheetId = (await storage.get("sheetId")) ?? "";
  const templateDocxId = (await storage.get("driveTemplateDocxId")) ?? "";
  const storedGenerateModel = await storage.get("defaultGenerateModel");
  const generateModel =
    storedGenerateModel && storedGenerateModel.length > 0
      ? storedGenerateModel
      : MIGRATION_DEFAULTS.defaultGenerateModel;

  const config: JobhelpConfig = {
    anthropicApiKey,
    appsScriptUrl,
    folders: {
      source: driveSourceFolderId,
      rules: driveRulesFolderId,
      output: driveOutputFolderId,
    },
    sheetId,
    templateDocxId,
    defaults: {
      model: generateModel,
      togglePreset: MIGRATION_DEFAULTS.togglePreset,
    },
    preferences: {
      autoConvertOnGenerate: MIGRATION_DEFAULTS.autoConvertOnGenerate,
      showCostInline: MIGRATION_DEFAULTS.showCostInline,
    },
  };

  return config;
}

/**
 * Remove the 8 deprecated v2.0 keys from chrome.storage.local. The new
 * `jobhelpConfigFileId` key and the 4 runtime-only keys
 * (lastToggles, presets, onboardingState, lastJobInsights, v2Toggles) are
 * preserved.
 *
 * IMPORTANT: only call this after the user has confirmed migration succeeded.
 * If the new Drive file is missing later, settings.ts will offer a re-entry
 * flow rather than silently losing data.
 */
export async function clearLegacySettings(): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  await c.storage.local.remove([...LEGACY_SETTINGS_KEYS]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Whether a usable chrome.storage.local is in scope. */
function hasChromeStorage(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  return !!c && !!c.storage && !!c.storage.local;
}

/**
 * Heuristic: is this legacy key actually populated by the user (vs the
 * schema default)? Strings are populated when non-null and non-empty.
 * `defaultGenerateModel` is treated as populated only when it differs from
 * the v2.0 default — otherwise the schema-default value would always trip
 * `hasLegacySettings()` on fresh installs.
 */
function isPopulated(
  key: LegacySettingsKey,
  value: string | null,
): boolean {
  if (value === null) return false;
  if (key === "defaultGenerateModel") {
    return value.length > 0 && value !== MIGRATION_DEFAULTS.defaultGenerateModel;
  }
  return value.length > 0;
}
