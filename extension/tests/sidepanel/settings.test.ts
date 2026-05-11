/** @vitest-environment jsdom */
/**
 * Tests for the rewritten Settings tab (v2.1 — single file-ID input).
 *
 * Covers:
 *   - DOM shape: one file-ID input (NOT eight separate inputs).
 *   - `maskApiKey` utility (sk-ant-…XXXX).
 *   - Reload-config success path → diagnostic block populated, status banner.
 *   - Reload-config validation failure → status banner + diagnostic stays empty.
 *   - "Migrate from local settings" visibility — hidden when no legacy keys
 *     are set, shown when at least one is set.
 *   - "Open config in Drive" opens the correct URL.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderSettingsTab, maskApiKey } from '../../src/sidepanel/tabs/settings';
import { clearConfigCache } from '../../src/lib/configLoader';
import { installChromeMock } from '../helpers/chrome-mocks';
import type { ApiClient } from '../../src/lib/apiClient';
import type { DownloadTemplateResponse } from '../../src/types/api-contract';

/** A canonical fully-valid config object. */
const VALID_CONFIG = {
  anthropicApiKey: 'sk-ant-fakekey-abcdef1234',
  appsScriptUrl: 'https://script.google.com/macros/s/FAKE/exec',
  folders: {
    source: 'src-folder-id',
    rules: 'rules-folder-id',
    output: 'out-folder-id',
  },
  sheetId: 'sheet-id-123',
  templateDocxId: 'template-docx-id-456',
  defaults: { model: 'claude-haiku-4-5-20251001', togglePreset: 'Quick' },
  preferences: { autoConvertOnGenerate: false, showCostInline: true },
};

function toBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function mockApiClient(
  response: DownloadTemplateResponse,
): {
  client: ApiClient;
  downloadTemplate: ReturnType<typeof vi.fn>;
  createDriveFile: ReturnType<typeof vi.fn>;
} {
  const downloadTemplate = vi.fn().mockResolvedValue(response);
  const createDriveFile = vi.fn();
  const client = { downloadTemplate, createDriveFile } as unknown as ApiClient;
  return { client, downloadTemplate, createDriveFile };
}

/** Stub window.open so we can assert it was called with the right URL. */
function stubWindowOpen(): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  Object.defineProperty(window, 'open', { value: fn, configurable: true });
  return fn;
}

beforeEach(() => {
  installChromeMock();
  clearConfigCache();
});

afterEach(() => {
  document.body.replaceChildren();
});

// ─────────────────────────────────────────────────────────────────────────────
// maskApiKey
// ─────────────────────────────────────────────────────────────────────────────

describe('maskApiKey', () => {
  it('shows the last 4 chars of a long key', () => {
    expect(maskApiKey('sk-ant-fakekey-abcdef1234')).toBe('sk-ant-…1234');
  });

  it('returns empty string for null / undefined / empty input', () => {
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey(undefined)).toBe('');
    expect(maskApiKey('')).toBe('');
  });

  it('falls back to `sk-ant-…` for keys with ≤4 chars', () => {
    expect(maskApiKey('abcd')).toBe('sk-ant-…');
    expect(maskApiKey('abc')).toBe('sk-ant-…');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM shape
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — DOM shape', () => {
  it('renders exactly one file-ID input (NOT eight separate fields)', () => {
    const root = renderSettingsTab({});
    const inputs = root.querySelectorAll('input.settings-row__input');
    expect(inputs.length).toBe(1);
    const input = inputs[0] as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.placeholder.toLowerCase()).toContain('drive file id');
  });

  it('renders the four required action buttons', () => {
    const root = renderSettingsTab({});
    const labels = Array.from(root.querySelectorAll('.settings__actions button')).map(
      (b) => b.textContent,
    );
    expect(labels).toContain('Reload config');
    expect(labels).toContain('Open config in Drive');
    expect(labels).toContain('Run onboarding');
    expect(labels).toContain('Migrate from local settings');
  });

  it('does not render the legacy 8-field form (no password input)', () => {
    const root = renderSettingsTab({});
    expect(root.querySelector('input[type="password"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reload config — success
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — Reload config (success)', () => {
  it('fetches, validates, and renders the masked diagnostic block', async () => {
    const { client, downloadTemplate } = mockApiClient({
      ok: true,
      base64: toBase64(VALID_CONFIG),
      fileName: 'jobhelp-config.json',
      mimeType: 'application/json',
    });
    const onConfigLoaded = vi.fn();
    const root = renderSettingsTab({ apiClient: client, onConfigLoaded });
    document.body.appendChild(root);

    const input = root.querySelector('input[data-settings-file-id]') as HTMLInputElement;
    input.value = 'file-1';

    const reloadBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reload config',
    )!;
    reloadBtn.click();

    // Wait a tick for the async chain.
    await new Promise((r) => setTimeout(r, 10));

    expect(downloadTemplate).toHaveBeenCalledWith({ fileId: 'file-1' });

    const status = root.querySelector('[data-settings-status]') as HTMLElement;
    expect(status.className).toContain('settings__status--success');

    const diag = root.querySelector('[data-settings-diagnostic]') as HTMLElement;
    expect(diag.textContent).toContain('sk-ant-…1234');
    expect(diag.textContent).toContain('src-folder-id');
    expect(diag.textContent).toContain('sheet-id-123');
    // API key should NEVER appear in full in the DOM.
    expect(diag.textContent).not.toContain('sk-ant-fakekey-abcdef1234');

    expect(onConfigLoaded).toHaveBeenCalledTimes(1);
    expect(onConfigLoaded.mock.calls[0][1]).toBe('file-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reload config — failure
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — Reload config (failure)', () => {
  it('surfaces a ConfigValidationError without populating the diagnostic block', async () => {
    const broken = { ...VALID_CONFIG } as Partial<typeof VALID_CONFIG>;
    delete broken.anthropicApiKey;
    const { client } = mockApiClient({
      ok: true,
      base64: toBase64(broken),
      fileName: 'jobhelp-config.json',
      mimeType: 'application/json',
    });
    const onConfigLoaded = vi.fn();
    const root = renderSettingsTab({ apiClient: client, onConfigLoaded });
    document.body.appendChild(root);

    const input = root.querySelector('input[data-settings-file-id]') as HTMLInputElement;
    input.value = 'file-broken';

    const reloadBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reload config',
    )!;
    reloadBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    const status = root.querySelector('[data-settings-status]') as HTMLElement;
    expect(status.className).toContain('settings__status--error');
    expect(status.textContent?.toLowerCase()).toContain('anthropicapikey');

    const diag = root.querySelector('[data-settings-diagnostic]') as HTMLElement;
    expect(diag.textContent).toContain('No config loaded yet');

    expect(onConfigLoaded).not.toHaveBeenCalled();
  });

  it('shows an error when no file id is entered', async () => {
    const { client } = mockApiClient({
      ok: true,
      base64: toBase64(VALID_CONFIG),
      fileName: 'jobhelp-config.json',
      mimeType: 'application/json',
    });
    const root = renderSettingsTab({ apiClient: client });
    document.body.appendChild(root);

    const reloadBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reload config',
    )!;
    reloadBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    const status = root.querySelector('[data-settings-status]') as HTMLElement;
    expect(status.className).toContain('settings__status--error');
    expect(status.textContent?.toLowerCase()).toContain('paste a jobhelp config');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration button visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — Migrate button visibility', () => {
  it('hides the migrate button when no legacy keys are populated', async () => {
    const root = renderSettingsTab({});
    document.body.appendChild(root);

    // Settle the async hydration call.
    await new Promise((r) => setTimeout(r, 10));

    const migrate = root.querySelector('[data-settings-migrate]') as HTMLElement;
    expect(migrate.style.display).toBe('none');
  });

  it('shows the migrate button when any legacy key is populated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({ appsScriptUrl: 'https://script.example.com/exec' });

    const root = renderSettingsTab({});
    document.body.appendChild(root);

    await new Promise((r) => setTimeout(r, 10));

    const migrate = root.querySelector('[data-settings-migrate]') as HTMLElement;
    expect(migrate.style.display).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "Open config in Drive"
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — Open in Drive', () => {
  it('opens the Drive view URL for the entered file ID', () => {
    const openSpy = stubWindowOpen();
    const root = renderSettingsTab({});
    document.body.appendChild(root);

    const input = root.querySelector('input[data-settings-file-id]') as HTMLInputElement;
    input.value = 'abc123';

    const openBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Open config in Drive',
    )!;
    openBtn.click();

    expect(openSpy).toHaveBeenCalledWith(
      'https://drive.google.com/file/d/abc123/edit',
      '_blank',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File-ID persistence
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSettingsTab — file-id persistence', () => {
  it('persists the file id to chrome.storage on input change', async () => {
    const root = renderSettingsTab({});
    document.body.appendChild(root);

    const input = root.querySelector('input[data-settings-file-id]') as HTMLInputElement;
    input.value = 'new-file-id';
    input.dispatchEvent(new Event('change'));

    await new Promise((r) => setTimeout(r, 10));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = (globalThis as any).chrome;
    const stored = await mock.storage.local.get('jobhelpConfigFileId');
    expect(stored.jobhelpConfigFileId).toBe('new-file-id');
  });

  it('hydrates the input from chrome.storage on mount', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({ jobhelpConfigFileId: 'preloaded-id' });

    const root = renderSettingsTab({});
    document.body.appendChild(root);

    await new Promise((r) => setTimeout(r, 10));

    const input = root.querySelector('input[data-settings-file-id]') as HTMLInputElement;
    expect(input.value).toBe('preloaded-id');
  });
});
