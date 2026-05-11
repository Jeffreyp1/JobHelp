/** @vitest-environment jsdom */
/**
 * Tests for the first-run Onboarding wizard.
 *
 * Covers:
 *   - Initial render: step 1 visible, hidden by default until open() is called.
 *   - Step transitions: 1 → 2 → 3 → 4.
 *   - Create-config success: API method called, file URL captured for step 3.
 *   - Create-config failure: error surfaced, can retry.
 *   - "Create config" button disabled with a tooltip when apiClient.createDriveFile
 *     is not available (graceful degradation while D1 is in flight).
 *   - Skip-to-step-4 escape hatch (user already has a config file).
 *   - Validate step happy path: loadConfigFromDrive runs, file id persisted,
 *     onComplete fires, wizard closes.
 *   - Validate step failure: ConfigValidationError surfaced, button re-enabled.
 *   - buildConfigTemplateJson produces parseable, schema-conformant JSON.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  renderOnboardingWizard,
  buildConfigTemplateJson,
} from '../../src/sidepanel/onboarding-wizard';
import { clearConfigCache } from '../../src/lib/configLoader';
import { installChromeMock } from '../helpers/chrome-mocks';
import type { ApiClient } from '../../src/lib/apiClient';
import type { DownloadTemplateResponse } from '../../src/types/api-contract';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

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

/** Build a mock ApiClient with downloadTemplate + createDriveFile vi.fn()s. */
function buildMockClient(opts: {
  downloadResponse?: DownloadTemplateResponse;
  createResponse?:
    | { ok: true; fileId: string; fileUrl: string }
    | { ok: false; error: { type: string; message: string; retryable: boolean } };
  hasCreateDriveFile?: boolean;
}): {
  client: ApiClient;
  downloadTemplate: ReturnType<typeof vi.fn>;
  createDriveFile: ReturnType<typeof vi.fn> | undefined;
} {
  const downloadTemplate = vi.fn().mockResolvedValue(
    opts.downloadResponse ?? {
      ok: true,
      base64: toBase64(VALID_CONFIG),
      fileName: 'jobhelp-config.json',
      mimeType: 'application/json',
    },
  );

  const hasCreate = opts.hasCreateDriveFile ?? true;
  let createDriveFile: ReturnType<typeof vi.fn> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = { downloadTemplate };
  if (hasCreate) {
    createDriveFile = vi.fn().mockResolvedValue(
      opts.createResponse ?? {
        ok: true,
        fileId: 'newly-created-file-id',
        fileUrl: 'https://drive.google.com/file/d/newly-created-file-id/edit',
      },
    );
    raw.createDriveFile = createDriveFile;
  }
  return { client: raw as ApiClient, downloadTemplate, createDriveFile };
}

beforeEach(() => {
  installChromeMock();
  clearConfigCache();
});

afterEach(() => {
  document.body.replaceChildren();
});

// ─────────────────────────────────────────────────────────────────────────────
// Template JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConfigTemplateJson', () => {
  it('produces parseable JSON with all schema fields and placeholders', () => {
    const json = buildConfigTemplateJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('anthropicApiKey');
    expect(parsed).toHaveProperty('appsScriptUrl');
    expect(parsed.folders).toHaveProperty('source');
    expect(parsed.folders).toHaveProperty('rules');
    expect(parsed.folders).toHaveProperty('output');
    expect(parsed).toHaveProperty('sheetId');
    expect(parsed).toHaveProperty('templateDocxId');
    expect(parsed.defaults).toHaveProperty('model');
    expect(parsed.defaults).toHaveProperty('togglePreset');
    expect(parsed.preferences).toHaveProperty('autoConvertOnGenerate');
    expect(parsed.preferences).toHaveProperty('showCostInline');

    // Placeholders signal "user must fill this in".
    expect(parsed.anthropicApiKey).toContain('paste');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initial render
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOnboardingWizard — initial state', () => {
  it('renders hidden by default; open() reveals the overlay', () => {
    const ctrl = renderOnboardingWizard({});
    document.body.appendChild(ctrl.root);
    expect(ctrl.root.style.display).toBe('none');

    ctrl.open();
    expect(ctrl.root.style.display).toBe('flex');
  });

  it('open() lands on step 1 by default', () => {
    const ctrl = renderOnboardingWizard({});
    document.body.appendChild(ctrl.root);
    ctrl.open();
    const indicator = ctrl.root.querySelector('.wizard-step-indicator');
    expect(indicator?.textContent).toBe('Step 1 of 4');
    const title = ctrl.root.querySelector('.wizard-title');
    expect(title?.textContent).toBe('Welcome to JobHelp');
  });

  it('close() hides the overlay and fires onClose', () => {
    const onClose = vi.fn();
    const ctrl = renderOnboardingWizard({ onClose });
    document.body.appendChild(ctrl.root);
    ctrl.open();
    ctrl.close();
    expect(ctrl.root.style.display).toBe('none');
    expect(onClose).toHaveBeenCalled();
    expect(ctrl.completed()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOnboardingWizard — step transitions', () => {
  it('"Get started" advances 1 → 2', () => {
    const ctrl = renderOnboardingWizard({});
    document.body.appendChild(ctrl.root);
    ctrl.open();
    const next = ctrl.root.querySelector('.wizard-next') as HTMLButtonElement;
    next.click();
    const indicator = ctrl.root.querySelector('.wizard-step-indicator');
    expect(indicator?.textContent).toBe('Step 2 of 4');
  });

  it('"Skip" jumps from step 2 to step 4', () => {
    const ctrl = renderOnboardingWizard({});
    document.body.appendChild(ctrl.root);
    ctrl.open(2);
    const skip = ctrl.root.querySelector('.wizard-skip') as HTMLButtonElement;
    skip.click();
    const indicator = ctrl.root.querySelector('.wizard-step-indicator');
    expect(indicator?.textContent).toBe('Step 4 of 4');
  });

  it('open(4) jumps directly to validate', () => {
    const ctrl = renderOnboardingWizard({});
    document.body.appendChild(ctrl.root);
    ctrl.open(4);
    const input = ctrl.root.querySelector('[data-wizard-file-id]');
    expect(input).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Create config
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOnboardingWizard — step 2 create', () => {
  it('calls apiClient.createDriveFile and advances to step 3 on success', async () => {
    const { client, createDriveFile } = buildMockClient({});
    const ctrl = renderOnboardingWizard({ apiClient: client });
    document.body.appendChild(ctrl.root);
    ctrl.open(2);

    const createBtn = ctrl.root.querySelector('.wizard-create') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);

    createBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(createDriveFile).toHaveBeenCalledTimes(1);
    const call = createDriveFile!.mock.calls[0][0];
    expect(call.fileName).toBe('jobhelp-config.json');
    expect(call.mimeType).toBe('application/json');
    // Content should be valid JSON.
    expect(() => JSON.parse(call.content)).not.toThrow();

    // Advanced to step 3.
    const indicator = ctrl.root.querySelector('.wizard-step-indicator');
    expect(indicator?.textContent).toBe('Step 3 of 4');
    const link = ctrl.root.querySelector('.wizard-open-link') as HTMLAnchorElement;
    expect(link.href).toContain('newly-created-file-id');
    expect(link.target).toBe('_blank');
  });

  it('disables the Create button with a tooltip when apiClient.createDriveFile is missing', () => {
    const { client } = buildMockClient({ hasCreateDriveFile: false });
    const ctrl = renderOnboardingWizard({ apiClient: client });
    document.body.appendChild(ctrl.root);
    ctrl.open(2);

    const createBtn = ctrl.root.querySelector('.wizard-create') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    expect(createBtn.title.length).toBeGreaterThan(0);
  });

  it('surfaces an error and re-enables the button when createDriveFile fails', async () => {
    const { client } = buildMockClient({
      createResponse: {
        ok: false,
        error: { type: 'drive', message: 'Permission denied', retryable: false },
      },
    });
    const ctrl = renderOnboardingWizard({ apiClient: client });
    document.body.appendChild(ctrl.root);
    ctrl.open(2);

    const createBtn = ctrl.root.querySelector('.wizard-create') as HTMLButtonElement;
    createBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    const status = ctrl.root.querySelector('[data-wizard-status]') as HTMLElement;
    expect(status.textContent).toContain('Permission denied');
    expect(status.className).toContain('wizard-status--error');

    // Still on step 2 so the user can retry.
    const indicator = ctrl.root.querySelector('.wizard-step-indicator');
    expect(indicator?.textContent).toBe('Step 2 of 4');
    const retryBtn = ctrl.root.querySelector('.wizard-create') as HTMLButtonElement;
    expect(retryBtn.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Validate
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOnboardingWizard — step 4 validate', () => {
  it('happy path: persists file id, fires onComplete, closes wizard', async () => {
    const { client, downloadTemplate } = buildMockClient({});
    const onComplete = vi.fn();
    const ctrl = renderOnboardingWizard({ apiClient: client, onComplete });
    document.body.appendChild(ctrl.root);
    ctrl.open(4);

    const input = ctrl.root.querySelector(
      '[data-wizard-file-id]',
    ) as HTMLInputElement;
    input.value = 'real-file-id';

    const validate = ctrl.root.querySelector(
      '.wizard-validate',
    ) as HTMLButtonElement;
    validate.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(downloadTemplate).toHaveBeenCalledWith({ fileId: 'real-file-id' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toBe('real-file-id');
    expect(ctrl.completed()).toBe(true);

    // Storage is now set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = (globalThis as any).chrome;
    const stored = await mock.storage.local.get('jobhelpConfigFileId');
    expect(stored.jobhelpConfigFileId).toBe('real-file-id');

    // Wait for the close timeout (600ms).
    await new Promise((r) => setTimeout(r, 700));
    expect(ctrl.root.style.display).toBe('none');
  });

  it('surfaces ConfigValidationError without closing the wizard', async () => {
    const broken = { ...VALID_CONFIG } as Partial<typeof VALID_CONFIG>;
    delete broken.sheetId;
    const { client } = buildMockClient({
      downloadResponse: {
        ok: true,
        base64: toBase64(broken),
        fileName: 'jobhelp-config.json',
        mimeType: 'application/json',
      },
    });
    const onComplete = vi.fn();
    const ctrl = renderOnboardingWizard({ apiClient: client, onComplete });
    document.body.appendChild(ctrl.root);
    ctrl.open(4);

    const input = ctrl.root.querySelector(
      '[data-wizard-file-id]',
    ) as HTMLInputElement;
    input.value = 'broken-file-id';

    const validate = ctrl.root.querySelector(
      '.wizard-validate',
    ) as HTMLButtonElement;
    validate.click();
    await new Promise((r) => setTimeout(r, 50));

    const status = ctrl.root.querySelector('[data-wizard-status]') as HTMLElement;
    expect(status.className).toContain('wizard-status--error');
    expect(status.textContent?.toLowerCase()).toContain('sheetid');

    expect(onComplete).not.toHaveBeenCalled();
    expect(ctrl.root.style.display).toBe('flex');
    expect(ctrl.completed()).toBe(false);

    // Button is re-enabled for retry.
    const retry = ctrl.root.querySelector(
      '.wizard-validate',
    ) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });

  it('errors when no file id is entered', async () => {
    const { client } = buildMockClient({});
    const ctrl = renderOnboardingWizard({ apiClient: client });
    document.body.appendChild(ctrl.root);
    ctrl.open(4);

    const validate = ctrl.root.querySelector(
      '.wizard-validate',
    ) as HTMLButtonElement;
    validate.click();
    await new Promise((r) => setTimeout(r, 10));

    const status = ctrl.root.querySelector('[data-wizard-status]') as HTMLElement;
    expect(status.className).toContain('wizard-status--error');
    expect(status.textContent?.toLowerCase()).toContain('paste');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 pre-fill from step 2
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOnboardingWizard — pre-fill flow', () => {
  it('after Create, step 4 input is pre-filled with the new file id', async () => {
    const { client } = buildMockClient({});
    const ctrl = renderOnboardingWizard({ apiClient: client });
    document.body.appendChild(ctrl.root);
    ctrl.open(2);

    // 2 → 3 (create succeeds)
    const createBtn = ctrl.root.querySelector('.wizard-create') as HTMLButtonElement;
    createBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    // 3 → 4 (continue)
    const cont = ctrl.root.querySelector('.wizard-continue') as HTMLButtonElement;
    cont.click();

    const input = ctrl.root.querySelector(
      '[data-wizard-file-id]',
    ) as HTMLInputElement;
    expect(input.value).toBe('newly-created-file-id');
  });
});
