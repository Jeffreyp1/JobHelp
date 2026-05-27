/**
 * onboardingState.ts
 *
 * Computes and advances the onboarding state machine for JobHelp.
 *
 * State transitions:
 *   noConfig     → appsScriptUrl + anthropicApiKey present → needsFolders
 *   needsFolders → all 4 folder/sheet ids present        → seeding
 *   seeding      → markSeedComplete() called              → ready
 *   ready        → canGenerate() === true
 *
 * The persisted `onboardingState` key in chrome.storage is used as an
 * override for states that can't be inferred from field presence alone
 * (i.e., `seeding` and `ready`).  If all fields are present AND the
 * persisted state is `ready`, the machine evaluates to `ready`.
 */

import type { OnboardingState as OS } from '../types/storage-schema.js';
import * as storage from './storage.js';

/** Human-readable labels keyed to their StorageKey. */
const FIELD_LABELS: Array<{ label: string; key: string }> = [
  { label: 'Apps Script URL', key: 'appsScriptUrl' },
  { label: 'Anthropic API key', key: 'anthropicApiKey' },
  { label: 'Drive source folder ID', key: 'driveSourceFolderId' },
  { label: 'Drive rules folder ID', key: 'driveRulesFolderId' },
  { label: 'Drive output folder ID', key: 'driveOutputFolderId' },
  { label: 'Tracking sheet ID', key: 'sheetId' },
];

/** Fields required to leave noConfig / needsApiKey. */
const BACKEND_FIELDS = ['appsScriptUrl', 'anthropicApiKey'] as const;

/** Fields required to leave needsFolders. */
const FOLDER_FIELDS = [
  'driveSourceFolderId',
  'driveRulesFolderId',
  'driveOutputFolderId',
  'sheetId',
] as const;

function hasAll(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((k) => {
    const v = record[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Compute the correct onboarding state from the raw storage data.
 * The persisted `onboardingState` is used as an authoritative override only
 * for `seeding` and `ready`; field presence determines `noConfig` and
 * `needsFolders`.
 */
function computeState(data: Record<string, unknown>): OS {
  const persisted = (data['onboardingState'] as OS | undefined) ?? 'noConfig';

  const hasBackend = hasAll(data, BACKEND_FIELDS);
  const hasFolders = hasAll(data, FOLDER_FIELDS);

  if (!hasBackend) {
    // Missing URL or API key → cannot progress further
    return 'noConfig';
  }

  if (!hasFolders) {
    // URL + key present but folders incomplete
    return 'needsFolders';
  }

  // All fields present — honour persisted state for seeding / ready
  if (persisted === 'ready') return 'ready';
  if (persisted === 'seeding') return 'seeding';

  // Folders just became complete for the first time → seeding
  return 'seeding';
}

export class OnboardingState {
  private _current: OS;

  private constructor(current: OS) {
    this._current = current;
  }

  /** Create from the current chrome.storage.local contents. */
  static async fromStorage(): Promise<OnboardingState> {
    const data = await storage.getAll();
    const current = computeState(data as unknown as Record<string, unknown>);
    return new OnboardingState(current);
  }

  /** Alias for fromStorage — allows `create()` call style. */
  static async create(): Promise<OnboardingState> {
    return OnboardingState.fromStorage();
  }

  /** Current state value. */
  get state(): OS {
    return this._current;
  }

  /**
   * Re-read chrome.storage and recompute state.
   * Call after mutating storage to keep the instance in sync.
   */
  async refresh(): Promise<void> {
    const data = await storage.getAll();
    this._current = computeState(data as unknown as Record<string, unknown>);
  }

  /** Whether the user may trigger a generation. */
  async canGenerate(): Promise<boolean> {
    await this.refresh();
    return this._current === 'ready';
  }

  /**
   * Returns human-readable labels of fields that are not yet configured.
   * Returns an empty array when state is `ready`.
   */
  async requiredFields(): Promise<string[]> {
    await this.refresh();
    if (this._current === 'ready') return [];

    const data = await storage.getAll();
    const raw = data as unknown as Record<string, unknown>;

    const missing: string[] = [];

    for (const { label, key } of FIELD_LABELS) {
      const v = raw[key];
      if (!(typeof v === 'string' && v.trim().length > 0)) {
        missing.push(label);
      }
    }

    return missing;
  }

  /**
   * Mark seed_defaults as successfully completed.
   * Persists `onboardingState: 'ready'` to storage and refreshes this instance.
   */
  async markSeedComplete(): Promise<void> {
    await storage.set('onboardingState', 'ready');
    await this.refresh();
  }

  /**
   * Reset all user-configuration keys and return state to `noConfig`.
   * Useful for the "Run onboarding again" button.
   */
  async reset(): Promise<void> {
    // Clear all configurable fields by writing nulls / empties
    const keysToReset: Array<keyof import('../types/storage-schema.js').StorageSchema> = [
      'appsScriptUrl',
      'anthropicApiKey',
      'driveSourceFolderId',
      'driveRulesFolderId',
      'driveOutputFolderId',
      'sheetId',
      'onboardingState',
    ];

    // Use chrome.storage.local.remove directly for the cleanest reset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).chrome;
    if (c && c.storage && c.storage.local) {
      await c.storage.local.remove(keysToReset);
    }

    this._current = 'noConfig';
  }
}
