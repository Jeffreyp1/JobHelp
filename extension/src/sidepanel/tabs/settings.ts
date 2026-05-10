/**
 * Settings tab — configuration form for backend URL, Anthropic key, Drive
 * folder ids, sheet id, and the default generate model. Plus action buttons
 * for opening Drive folders, resetting rules to defaults, and re-running
 * onboarding.
 *
 * The form auto-loads existing values from chrome.storage.local on mount and
 * persists every change via the typed storage wrapper.
 */

import { get, set } from '../../lib/storage.js';
import type { StorageSchema, StorageKey } from '../../types/storage-schema.js';
import { OnboardingState } from '../../lib/onboardingState.js';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

export interface SettingsTabHooks {
  /** Open the source-materials Drive folder by id. */
  openSourceFolder?: (id: string) => void;
  /** Open the rules Drive folder by id. */
  openRulesFolder?: (id: string) => void;
  /** Trigger seed_defaults against the backend. */
  resetRulesToDefaults?: () => void | Promise<void>;
  /** Restart the onboarding flow. */
  runOnboarding?: () => void;
}

export function renderSettingsTab(hooks: SettingsTabHooks = {}): HTMLElement {
  const root = document.createElement('section');
  root.className = 'tab-pane tab-pane--settings';

  const heading = document.createElement('h2');
  heading.className = 'settings__title';
  heading.textContent = 'Settings';
  root.appendChild(heading);

  // ── Onboarding status banner ──────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.className = 'onboarding-banner';
  banner.setAttribute('aria-live', 'polite');
  root.appendChild(banner);

  // Seed button (shown only when state === 'seeding')
  const seedBtn = document.createElement('button');
  seedBtn.type = 'button';
  seedBtn.className = 'btn btn-primary onboarding-seed-btn';
  seedBtn.textContent = 'Seed rule files';
  seedBtn.style.display = 'none';
  seedBtn.addEventListener('click', () => {
    void (async () => {
      seedBtn.disabled = true;
      seedBtn.textContent = 'Seeding…';
      try {
        await hooks.resetRulesToDefaults?.();
        const state = await OnboardingState.fromStorage();
        await state.markSeedComplete();
        await refreshBanner();
      } catch {
        seedBtn.disabled = false;
        seedBtn.textContent = 'Seed rule files';
      }
    })();
  });
  root.appendChild(seedBtn);

  async function refreshBanner(): Promise<void> {
    const state = await OnboardingState.fromStorage();
    const s = state.state;

    // Update banner text + variant
    const labels: Record<string, string> = {
      noConfig: 'Setup incomplete — paste your Apps Script URL and Anthropic API key below.',
      needsApiKey: 'Setup incomplete — paste your Anthropic API key below.',
      needsFolders: 'API key saved — now set your Drive folder IDs and sheet ID below.',
      seeding: 'Almost ready — click "Seed rule files" to populate your rules folder.',
      ready: 'Setup complete. JobHelp is ready.',
    };
    banner.textContent = labels[s] ?? s;
    banner.className = `onboarding-banner onboarding-banner--${s === 'ready' ? 'success' : 'warning'}`;

    // Show seed button only in seeding state
    seedBtn.style.display = s === 'seeding' ? 'block' : 'none';
    seedBtn.disabled = false;
    seedBtn.textContent = 'Seed rule files';
  }

  // Initial banner render (async; non-blocking)
  void refreshBanner();

  const form = document.createElement('form');
  form.className = 'settings__form';
  form.addEventListener('submit', (e) => e.preventDefault());

  // Each row binds to a storage key.
  form.appendChild(
    makeStorageRow({
      key: 'appsScriptUrl',
      label: 'Apps Script URL',
      type: 'url',
      placeholder: 'https://script.google.com/macros/s/.../exec',
      help: 'Your Apps Script web-app /exec URL.',
    }),
  );

  form.appendChild(
    makeStorageRow({
      key: 'anthropicApiKey',
      label: 'Anthropic API key',
      type: 'password',
      placeholder: 'sk-ant-...',
      help: 'Stored locally only. Never sent anywhere except Anthropic.',
    }),
  );

  form.appendChild(
    makeStorageRow({
      key: 'driveSourceFolderId',
      label: 'Drive: source folder ID',
      type: 'text',
      placeholder: 'Drive folder ID',
      help: 'Folder containing your source materials (history, draft bullets, etc.).',
    }),
  );

  form.appendChild(
    makeStorageRow({
      key: 'driveRulesFolderId',
      label: 'Drive: rules folder ID',
      type: 'text',
      placeholder: 'Drive folder ID',
      help: 'Folder containing the rule files (auto-seeded on first run).',
    }),
  );

  form.appendChild(
    makeStorageRow({
      key: 'driveOutputFolderId',
      label: 'Drive: output folder ID',
      type: 'text',
      placeholder: 'Drive folder ID',
      help: 'Where tailored resumes are written.',
    }),
  );

  form.appendChild(
    makeStorageRow({
      key: 'sheetId',
      label: 'Tracking sheet ID',
      type: 'text',
      placeholder: 'Spreadsheet ID',
      help: 'Each generation appends a row here.',
    }),
  );

  form.appendChild(
    makeModelSelectRow({
      key: 'defaultGenerateModel',
      label: 'Default generate model',
      options: [
        { value: HAIKU, label: 'Haiku 4.5 — fast & cheap (default)' },
        { value: SONNET, label: 'Sonnet 4.6 — balanced' },
        { value: OPUS, label: 'Opus 4.7 — top quality' },
      ],
    }),
  );

  root.appendChild(form);

  // Action buttons row
  const actions = document.createElement('div');
  actions.className = 'settings__actions';

  actions.appendChild(
    makeButton('Open source folder', 'btn-secondary', async () => {
      const id = (await get('driveSourceFolderId')) ?? '';
      if (!id) return alert('Set the source folder ID first.');
      if (hooks.openSourceFolder) hooks.openSourceFolder(id);
      else window.open(`https://drive.google.com/drive/folders/${id}`, '_blank');
    }),
  );

  actions.appendChild(
    makeButton('Open rule files', 'btn-secondary', async () => {
      const id = (await get('driveRulesFolderId')) ?? '';
      if (!id) return alert('Set the rules folder ID first.');
      if (hooks.openRulesFolder) hooks.openRulesFolder(id);
      else window.open(`https://drive.google.com/drive/folders/${id}`, '_blank');
    }),
  );

  actions.appendChild(
    makeButton('Open output folder', 'btn-secondary', async () => {
      const id = (await get('driveOutputFolderId')) ?? '';
      if (!id) return alert('Set the output folder ID first.');
      window.open(`https://drive.google.com/drive/folders/${id}`, '_blank');
    }),
  );

  actions.appendChild(
    makeButton('Open tracking sheet', 'btn-secondary', async () => {
      const id = (await get('sheetId')) ?? '';
      if (!id) return alert('Set the tracking sheet ID first.');
      window.open(`https://docs.google.com/spreadsheets/d/${id}/edit`, '_blank');
    }),
  );

  actions.appendChild(
    makeButton('Reset rules to defaults', 'btn-secondary', async () => {
      if (!confirm('Re-seed rule files from GitHub? Local edits will be overwritten.')) return;
      await hooks.resetRulesToDefaults?.();
    }),
  );

  actions.appendChild(
    makeButton('Run onboarding wizard', 'btn-secondary', async () => {
      hooks.runOnboarding?.();
      // Walk through missing fields sequentially with prompts
      const state = await OnboardingState.fromStorage();
      const missing = await state.requiredFields();
      if (missing.length === 0) {
        alert('All fields are already configured. JobHelp is ready!');
        return;
      }
      alert(
        `To complete setup, fill in the following fields:\n\n• ${missing.join('\n• ')}\n\nScroll down to the form below.`,
      );
      void refreshBanner();
    }),
  );

  actions.appendChild(
    makeButton('Run onboarding again', 'btn-secondary', async () => {
      if (!confirm('Reset all settings and restart onboarding?')) return;
      const state = await OnboardingState.fromStorage();
      await state.reset();
      hooks.runOnboarding?.();
      void refreshBanner();
    }),
  );

  root.appendChild(actions);

  return root;
}

interface StorageRowOpts<K extends StorageKey> {
  key: K;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  help?: string;
}

function makeStorageRow<K extends StorageKey>(opts: StorageRowOpts<K>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const lbl = document.createElement('label');
  lbl.className = 'settings-row__label';
  lbl.textContent = opts.label;
  const input = document.createElement('input');
  input.className = 'settings-row__input';
  input.type = opts.type;
  if (opts.placeholder) input.placeholder = opts.placeholder;

  // Hydrate
  void (async () => {
    try {
      const v = await get(opts.key);
      if (typeof v === 'string') input.value = v;
    } catch {
      // ignore
    }
  })();

  // Persist on change
  input.addEventListener('change', () => {
    void set(opts.key, input.value as StorageSchema[K]);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  if (opts.help) {
    const help = document.createElement('div');
    help.className = 'settings-row__help';
    help.textContent = opts.help;
    row.appendChild(help);
  }
  return row;
}

interface ModelSelectOpts<K extends StorageKey> {
  key: K;
  label: string;
  options: Array<{ value: string; label: string }>;
}

function makeModelSelectRow<K extends StorageKey>(opts: ModelSelectOpts<K>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row settings-row--select';
  const lbl = document.createElement('label');
  lbl.className = 'settings-row__label';
  lbl.textContent = opts.label;
  const sel = document.createElement('select');
  sel.className = 'settings-row__select';
  for (const o of opts.options) {
    const optEl = document.createElement('option');
    optEl.value = o.value;
    optEl.textContent = o.label;
    sel.appendChild(optEl);
  }

  void (async () => {
    try {
      const v = await get(opts.key);
      if (typeof v === 'string') sel.value = v;
    } catch {
      // ignore
    }
  })();

  sel.addEventListener('change', () => {
    void set(opts.key, sel.value as StorageSchema[K]);
  });

  row.appendChild(lbl);
  row.appendChild(sel);
  return row;
}

function makeButton(label: string, variant: string, onClick: () => void | Promise<void>): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${variant}`;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    void onClick();
  });
  return btn;
}
