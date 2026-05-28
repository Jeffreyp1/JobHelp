import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../extension/src/lib/apiClient';
import { clearConfigCache, loadConfigFromDrive } from '../../extension/src/lib/configLoader';
import { ConfigValidationError } from '../../extension/src/types/jobhelp-config';

function validConfig() {
  return {
    anthropicApiKey: 'sk-ant-test-key',
    appsScriptUrl: 'https://script.google.com/macros/s/test/exec',
    folders: {
      source: 'source-folder',
      rules: 'rules-folder',
      output: 'output-folder',
    },
    sheetId: 'sheet-id',
    templateDocxId: 'template-docx-id',
    defaults: {
      model: 'claude-haiku-4-5-20251001',
      togglePreset: 'standard',
    },
    preferences: {
      autoConvertOnGenerate: true,
      showCostInline: false,
    },
  };
}

async function loadConfig(config: unknown) {
  const client = new ApiClient('https://script.google.com/macros/s/test/exec');
  vi.spyOn(client, 'downloadTemplate').mockResolvedValue({
    ok: true,
    base64: btoa(JSON.stringify(config)),
    fileName: 'jobhelp-config.json',
    mimeType: 'application/json',
  });

  return loadConfigFromDrive('config-file-id', client);
}

describe('loadConfigFromDrive validation', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('accepts an empty templateDocxId', async () => {
    const config = {
      ...validConfig(),
      templateDocxId: '',
    };

    await expect(loadConfig(config)).resolves.toMatchObject({
      templateDocxId: '',
    });
  });

  it('rejects a non-string templateDocxId', async () => {
    const config = {
      ...validConfig(),
      templateDocxId: 42,
    };

    await expect(loadConfig(config)).rejects.toMatchObject({
      field: 'templateDocxId',
    });
    await expect(loadConfig(config)).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it.each([
    ['anthropicApiKey', (config: ReturnType<typeof validConfig>) => {
      config.anthropicApiKey = '';
    }],
    ['appsScriptUrl', (config: ReturnType<typeof validConfig>) => {
      config.appsScriptUrl = '';
    }],
    ['folders.source', (config: ReturnType<typeof validConfig>) => {
      config.folders.source = '';
    }],
    ['folders.rules', (config: ReturnType<typeof validConfig>) => {
      config.folders.rules = '';
    }],
    ['folders.output', (config: ReturnType<typeof validConfig>) => {
      config.folders.output = '';
    }],
    ['sheetId', (config: ReturnType<typeof validConfig>) => {
      config.sheetId = '';
    }],
    ['defaults.model', (config: ReturnType<typeof validConfig>) => {
      config.defaults.model = '';
    }],
    ['defaults.togglePreset', (config: ReturnType<typeof validConfig>) => {
      config.defaults.togglePreset = '';
    }],
  ])('rejects an empty %s', async (field, makeEmpty) => {
    const config = validConfig();
    makeEmpty(config);

    await expect(loadConfig(config)).rejects.toMatchObject({
      field,
    });
  });
});
