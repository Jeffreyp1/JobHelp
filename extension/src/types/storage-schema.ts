/**
 * Schema for chrome.storage.local. All storage access goes through src/lib/storage.ts
 * which provides type-safe getters and setters keyed off this schema.
 *
 * v2.1 setup-simplification (Approach C): the 8 "settings" keys
 * (anthropicApiKey, appsScriptUrl, the 3 driveXxxFolderId keys, sheetId,
 * driveTemplateDocxId, defaultGenerateModel) have been moved into a single
 * `jobhelp-config.json` file hosted in the user's Drive. The extension now
 * only remembers the Drive *file id* of that config (`jobhelpConfigFileId`)
 * to bootstrap on any machine.
 *
 * The 8 deprecated keys remain in the type for the migration window — code
 * paths that still reference them must continue to compile while
 * configMigration.ts reads them, builds a JobhelpConfig, and then clears
 * them via `clearLegacySettings()`.
 */

import type { ToggleConfig } from "./api-contract.js";
import type { JobInsights } from "./job-insights.js";

export type OnboardingState = "noConfig" | "needsApiKey" | "needsFolders" | "seeding" | "ready";

export interface StoredPreset {
  name: string;
  config: ToggleConfig;
  /** Default Anthropic model for the generate step */
  generateModel: string;
}

export interface CachedJobInsights {
  url: string;
  insights: JobInsights;
  timestamp: number;
}

export interface V2TogglesState {
  researchEnabled: boolean;
  researchModel: string;
  benchmarkEnabled: boolean;
  benchmarkModel: string;
  critiqueEnabled: boolean;
  critiqueModel: string;
  autoReviseEnabled: boolean;
  autoReviseModel: string;
  coverLetterEnabled: boolean;
  coverLetterModel: string;
  coverLetterTone: string;
  verifyHooksModel: string;
  multiVersionEnabled: boolean;
  multiVersionModel: string;
  multiVersionCount: number;
}

export interface StorageSchema {
  /**
   * v2.1 primary key: Drive file id of the user's `jobhelp-config.json`.
   * This is the ONLY value the user pastes on a fresh install — everything
   * else (API key, folder IDs, etc.) is loaded from the Drive file.
   */
  jobhelpConfigFileId: string | null;

  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  appsScriptUrl: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  anthropicApiKey: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  driveSourceFolderId: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  driveRulesFolderId: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  driveOutputFolderId: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  driveTemplateDocxId: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  sheetId: string | null;
  /** @deprecated v2.1: moved to JobhelpConfig in Drive. Read-only fallback for migration. */
  defaultGenerateModel: string;

  /** Last-used toggle config; restored on side-panel open */
  lastToggles: ToggleConfig;
  /** Saved named presets */
  presets: StoredPreset[];

  /** Onboarding flow state */
  onboardingState: OnboardingState;
  /** Last successful scrape — restores Job Insights card on re-open */
  lastJobInsights: CachedJobInsights | null;

  /** Last-used v2 toggle state (per-feature enable + model + count). */
  v2Toggles: V2TogglesState | null;
}

export const STORAGE_DEFAULTS: StorageSchema = {
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
  v2Toggles: null,
};

/** Type-safe storage keys (use as parameters to chrome.storage.local.get) */
export type StorageKey = keyof StorageSchema;

/**
 * The 8 v2.0 keys that moved into JobhelpConfig in v2.1. Used by
 * `configMigration.ts` to detect legacy installs and clean up after a
 * successful migration.
 *
 * Treat this list as the canonical source of truth — do NOT inline the
 * names elsewhere; import this constant so adding/removing a deprecated
 * key is a one-line change.
 */
export const LEGACY_SETTINGS_KEYS = [
  "anthropicApiKey",
  "appsScriptUrl",
  "driveSourceFolderId",
  "driveRulesFolderId",
  "driveOutputFolderId",
  "driveTemplateDocxId",
  "sheetId",
  "defaultGenerateModel",
] as const satisfies readonly StorageKey[];

export type LegacySettingsKey = (typeof LEGACY_SETTINGS_KEYS)[number];
