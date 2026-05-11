/**
 * configMigration.test.ts
 *
 * Tests the v2.0 → v2.1 setup-simplification migration helper.
 *
 * Strategy: install a fresh chrome.storage mock per test via
 * `installChromeMock()`, populate the 8 deprecated keys directly, then
 * assert detection / build / clear behavior.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  hasLegacySettings,
  buildConfigFromLegacy,
  clearLegacySettings,
} from "../../src/lib/configMigration";
import { installChromeMock } from "../helpers/chrome-mocks";
import { LEGACY_SETTINGS_KEYS } from "../../src/types/storage-schema.js";
import type { JobhelpConfig } from "../../src/types/jobhelp-config.js";

const HAIKU_DEFAULT = "claude-haiku-4-5-20251001";
const NON_DEFAULT_MODEL = "claude-sonnet-4-6";

/** Populate all 8 deprecated keys with realistic values. */
async function seedAllLegacyKeys(): Promise<void> {
  await chrome.storage.local.set({
    anthropicApiKey: "sk-ant-fake-key",
    appsScriptUrl: "https://script.google.com/macros/s/FAKE/exec",
    driveSourceFolderId: "src-folder-id",
    driveRulesFolderId: "rules-folder-id",
    driveOutputFolderId: "out-folder-id",
    driveTemplateDocxId: "template-docx-id-456",
    sheetId: "sheet-id-123",
    defaultGenerateModel: NON_DEFAULT_MODEL,
  });
}

beforeEach(() => {
  installChromeMock();
});

// ─────────────────────────────────────────────────────────────────────────────
// hasLegacySettings
// ─────────────────────────────────────────────────────────────────────────────

describe("hasLegacySettings", () => {
  it("returns false when ALL deprecated keys are empty / absent", async () => {
    const result = await hasLegacySettings();
    expect(result).toBe(false);
  });

  it("returns false when only the schema-default model is stored", async () => {
    // The schema default for defaultGenerateModel is HAIKU; storing the same
    // value should not flip hasLegacySettings to true (otherwise every fresh
    // install would look like a legacy install).
    await chrome.storage.local.set({
      defaultGenerateModel: HAIKU_DEFAULT,
    });
    const result = await hasLegacySettings();
    expect(result).toBe(false);
  });

  it("returns true when ONE deprecated key is populated (anthropicApiKey)", async () => {
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-only-this-one",
    });
    const result = await hasLegacySettings();
    expect(result).toBe(true);
  });

  it("returns true when ONE deprecated key is populated (sheetId)", async () => {
    await chrome.storage.local.set({
      sheetId: "some-sheet-id",
    });
    const result = await hasLegacySettings();
    expect(result).toBe(true);
  });

  it("returns true when defaultGenerateModel differs from the schema default", async () => {
    await chrome.storage.local.set({
      defaultGenerateModel: NON_DEFAULT_MODEL,
    });
    const result = await hasLegacySettings();
    expect(result).toBe(true);
  });

  it("returns true when ALL deprecated keys are populated", async () => {
    await seedAllLegacyKeys();
    const result = await hasLegacySettings();
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConfigFromLegacy — happy path + defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConfigFromLegacy — success", () => {
  it("builds a correct JobhelpConfig when all 8 keys are present", async () => {
    await seedAllLegacyKeys();
    const result = await buildConfigFromLegacy();

    // Narrow the union — { error } vs JobhelpConfig.
    expect("error" in result).toBe(false);
    const config = result as JobhelpConfig;

    expect(config.anthropicApiKey).toBe("sk-ant-fake-key");
    expect(config.appsScriptUrl).toBe(
      "https://script.google.com/macros/s/FAKE/exec",
    );
    expect(config.folders.source).toBe("src-folder-id");
    expect(config.folders.rules).toBe("rules-folder-id");
    expect(config.folders.output).toBe("out-folder-id");
    expect(config.sheetId).toBe("sheet-id-123");
    expect(config.templateDocxId).toBe("template-docx-id-456");
    expect(config.defaults.model).toBe(NON_DEFAULT_MODEL);
    // togglePreset has no legacy source — falls back to "Quick".
    expect(config.defaults.togglePreset).toBe("Quick");
    // preferences have no legacy source — fall back to defaults.
    expect(config.preferences.autoConvertOnGenerate).toBe(false);
    expect(config.preferences.showCostInline).toBe(true);
  });

  it("applies the HAIKU default when defaultGenerateModel is absent", async () => {
    // Set the required fields only — leave defaultGenerateModel as the
    // schema default (which configMigration treats as "missing" for the
    // migration default fallback).
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-required",
      appsScriptUrl: "https://example.com/exec",
      driveSourceFolderId: "src",
      driveRulesFolderId: "rules",
      driveOutputFolderId: "out",
      driveTemplateDocxId: "tpl",
      sheetId: "sheet",
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(false);
    const config = result as JobhelpConfig;
    expect(config.defaults.model).toBe(HAIKU_DEFAULT);
  });

  it("uses the configured defaults for togglePreset / autoConvertOnGenerate / showCostInline", async () => {
    // Required fields only — verify the four migration defaults exactly.
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-key",
      appsScriptUrl: "https://example.com/exec",
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(false);
    const config = result as JobhelpConfig;
    expect(config.defaults.model).toBe(HAIKU_DEFAULT);
    expect(config.defaults.togglePreset).toBe("Quick");
    expect(config.preferences.autoConvertOnGenerate).toBe(false);
    expect(config.preferences.showCostInline).toBe(true);
  });

  it("uses empty strings for folder / sheet / template ids when absent", async () => {
    // The new config schema requires these to be present (the loader
    // validates them); the migration helper still produces a config object
    // so the caller can show the user the gaps in a single screen.
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-key",
      appsScriptUrl: "https://example.com/exec",
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(false);
    const config = result as JobhelpConfig;
    expect(config.folders.source).toBe("");
    expect(config.folders.rules).toBe("");
    expect(config.folders.output).toBe("");
    expect(config.sheetId).toBe("");
    expect(config.templateDocxId).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConfigFromLegacy — error paths
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConfigFromLegacy — error paths", () => {
  it("returns {error} when anthropicApiKey is missing", async () => {
    // Seed everything *except* the api key.
    await chrome.storage.local.set({
      appsScriptUrl: "https://example.com/exec",
      driveSourceFolderId: "src",
      driveRulesFolderId: "rules",
      driveOutputFolderId: "out",
      driveTemplateDocxId: "tpl",
      sheetId: "sheet",
      defaultGenerateModel: NON_DEFAULT_MODEL,
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(true);
    const err = (result as { error: string }).error;
    expect(err.toLowerCase()).toContain("anthropicapikey");
  });

  it("returns {error} when anthropicApiKey is the empty string", async () => {
    await chrome.storage.local.set({
      anthropicApiKey: "",
      appsScriptUrl: "https://example.com/exec",
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error.toLowerCase()).toContain(
      "anthropicapikey",
    );
  });

  it("returns {error} when appsScriptUrl is missing", async () => {
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-key",
      driveSourceFolderId: "src",
      driveRulesFolderId: "rules",
      driveOutputFolderId: "out",
      driveTemplateDocxId: "tpl",
      sheetId: "sheet",
      defaultGenerateModel: NON_DEFAULT_MODEL,
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(true);
    const err = (result as { error: string }).error;
    expect(err.toLowerCase()).toContain("appsscripturl");
  });

  it("returns {error} when appsScriptUrl is the empty string", async () => {
    await chrome.storage.local.set({
      anthropicApiKey: "sk-ant-key",
      appsScriptUrl: "",
    });

    const result = await buildConfigFromLegacy();
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error.toLowerCase()).toContain(
      "appsscripturl",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearLegacySettings
// ─────────────────────────────────────────────────────────────────────────────

describe("clearLegacySettings", () => {
  it("removes all 8 deprecated keys", async () => {
    await seedAllLegacyKeys();
    // Sanity-check: the keys are actually present in the backing store.
    const beforeRaw = await chrome.storage.local.get([...LEGACY_SETTINGS_KEYS]);
    expect(Object.keys(beforeRaw).length).toBe(LEGACY_SETTINGS_KEYS.length);

    await clearLegacySettings();

    const afterRaw = await chrome.storage.local.get([...LEGACY_SETTINGS_KEYS]);
    // The mock returns only keys that exist in the backing store, so after
    // remove the result must be an empty object.
    expect(afterRaw).toEqual({});
  });

  it("preserves the new jobhelpConfigFileId key", async () => {
    await seedAllLegacyKeys();
    await chrome.storage.local.set({
      jobhelpConfigFileId: "drive-file-id-xyz",
    });

    await clearLegacySettings();

    const after = await chrome.storage.local.get("jobhelpConfigFileId");
    expect(after.jobhelpConfigFileId).toBe("drive-file-id-xyz");
  });

  it("preserves the runtime-only keys (lastToggles, presets, onboardingState, lastJobInsights, v2Toggles)", async () => {
    await seedAllLegacyKeys();
    const runtimeFixtures = {
      lastToggles: { research: { enabled: false, model: HAIKU_DEFAULT } },
      presets: [{ name: "p", config: {}, generateModel: HAIKU_DEFAULT }],
      onboardingState: "ready" as const,
      lastJobInsights: null,
      v2Toggles: null,
    };
    await chrome.storage.local.set(runtimeFixtures);

    await clearLegacySettings();

    const after = await chrome.storage.local.get([
      "lastToggles",
      "presets",
      "onboardingState",
      "lastJobInsights",
      "v2Toggles",
    ]);
    expect(after.lastToggles).toEqual(runtimeFixtures.lastToggles);
    expect(after.presets).toEqual(runtimeFixtures.presets);
    expect(after.onboardingState).toBe("ready");
    expect(after.lastJobInsights).toBeNull();
    expect(after.v2Toggles).toBeNull();
  });

  it("is a no-op when chrome.storage is unavailable", async () => {
    // Remove the mock entirely — clearLegacySettings should not throw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = undefined;
    await expect(clearLegacySettings()).resolves.toBeUndefined();
  });

  it("after clear + hasLegacySettings → returns false", async () => {
    await seedAllLegacyKeys();
    expect(await hasLegacySettings()).toBe(true);
    await clearLegacySettings();
    expect(await hasLegacySettings()).toBe(false);
  });
});
