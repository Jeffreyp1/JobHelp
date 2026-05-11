/**
 * Schema for chrome.storage.local. All storage access goes through src/lib/storage.ts
 * which provides type-safe getters and setters keyed off this schema.
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
  /** Apps Script web app /exec URL */
  appsScriptUrl: string | null;
  /** Anthropic API key. Stored locally only. Never sent to GitHub or any third-party. */
  anthropicApiKey: string | null;
  /** Drive folder ids */
  driveSourceFolderId: string | null;
  driveRulesFolderId: string | null;
  driveOutputFolderId: string | null;
  /**
   * Drive file id of the user's uploaded template .docx (containing
   * docxtemplater placeholders). When set, the Generate tab's
   * "Convert via Template (DOCX)" button is enabled.
   */
  driveTemplateDocxId: string | null;
  /** Tracking sheet id */
  sheetId: string | null;

  /** Default model for generate (per-feature models live inside ToggleConfig) */
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
