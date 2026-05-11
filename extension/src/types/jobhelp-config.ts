/**
 * Schema for the single Drive-hosted JobHelp config file (`jobhelp-config.json`).
 *
 * Approach C from docs/superpowers/plans/2026-05-10-future-setup-simplification.md.
 *
 * v2.x goal: consolidate the eight per-machine `chrome.storage` values
 * (anthropicApiKey, appsScriptUrl, folder IDs, sheetId, templateDocxId,
 * defaultGenerateModel, etc.) into one JSON file in the user's Drive. The
 * extension then only needs to remember the Drive *file id* of this config
 * to bootstrap on any machine.
 *
 * This file declares the shape only — the loader lives in
 * `extension/src/lib/configLoader.ts`. Nothing in the app currently consumes
 * `JobhelpConfig`; wiring is deferred to a follow-up milestone.
 */

/** Drive folder ids used by the generate / finalize pipelines. */
export interface JobhelpFolders {
  /** Folder containing source materials (resume, prior cover letters, etc.). */
  source: string;
  /** Folder containing the prompt-rules markdown files (01-priority, etc.). */
  rules: string;
  /** Folder where generated job sub-folders are created. */
  output: string;
}

/** Per-feature default values applied on a fresh session. */
export interface JobhelpDefaults {
  /** Default Anthropic model id for the generate step. */
  model: string;
  /** Name of the preset to auto-load on side-panel open. */
  togglePreset: string;
}

/** UI preferences — non-load-bearing toggles for behavior + display. */
export interface JobhelpPreferences {
  /** If true, run finalize automatically after generate succeeds. */
  autoConvertOnGenerate: boolean;
  /** If true, show per-call USD cost inline in the side-panel. */
  showCostInline: boolean;
}

/**
 * Root shape of `jobhelp-config.json`. Mirrors the JSON in the v2.x plan
 * (Approach C — "Concrete v2.x" sub-section).
 */
export interface JobhelpConfig {
  /** Anthropic API key (sk-ant-…). Stored only inside this Drive file. */
  anthropicApiKey: string;
  /** Apps Script web app /exec URL. */
  appsScriptUrl: string;
  /** Drive folder ids for source / rules / output. */
  folders: JobhelpFolders;
  /** Tracking sheet id. */
  sheetId: string;
  /** Drive file id of the user's uploaded resume template .docx. */
  templateDocxId: string;
  /** Per-feature defaults. */
  defaults: JobhelpDefaults;
  /** UI / behavior preferences. */
  preferences: JobhelpPreferences;
}

/**
 * Typed error raised by configLoader when the Drive file is missing required
 * keys, has the wrong types, or otherwise fails schema validation.
 *
 * `field` is the dotted path to the offending key (e.g. `"folders.source"`)
 * so callers can surface a precise message in the Settings UI.
 */
export class ConfigValidationError extends Error {
  /** Dotted path of the offending field (`"folders.source"`), or `null` if
   *  the failure is not field-specific (malformed JSON / non-object root). */
  public readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = "ConfigValidationError";
    this.field = field;
    // Restore prototype chain — required for `instanceof` to work after
    // transpilation to ES5 / when thrown across async boundaries.
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}
