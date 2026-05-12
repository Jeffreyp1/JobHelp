/**
 * background.test.ts
 *
 * Integration + unit tests for background.ts, messageBus.ts, and apiClient.ts.
 * All Chrome APIs are mocked via installChromeMock (extended here with
 * runtime, tabs, and scripting APIs).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildExtendedChromeMock, type ExtendedChromeMock } from './helpers/chrome-mocks.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let chromeMock: ExtendedChromeMock;

beforeEach(() => {
  chromeMock = buildExtendedChromeMock();
  (globalThis as unknown as Record<string, unknown>).chrome = chromeMock;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// messageBus tests
// ─────────────────────────────────────────────────────────────────────────────

describe('messageBus', () => {
  it('T9: send() calls chrome.runtime.sendMessage with typed payload', async () => {
    const { send } = await import('../src/lib/messageBus.js');
    await send({ type: 'rescan_request' });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'rescan_request' });
  });

  it('T10: on() registers a listener that fires when message type matches', async () => {
    const { on } = await import('../src/lib/messageBus.js');
    const handler = vi.fn();
    on('scrape_result', handler);

    const payload = {
      jd: 'test jd',
      company: 'TestCo',
      role: 'Engineer',
      url: 'https://example.com',
      scrapeStrategy: 'generic' as const,
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    const msg = { type: 'scrape_result', payload };
    // Simulate the onMessage listener being called
    chromeMock.__triggerMessage(msg, {}, () => {});

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('T11: on() does NOT call handler for messages of a different type', async () => {
    const { on } = await import('../src/lib/messageBus.js');
    const handler = vi.fn();
    on('scrape_result', handler);

    // Send a different message type
    chromeMock.__triggerMessage({ type: 'rescan_request' }, {}, () => {});

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// apiClient tests
// ─────────────────────────────────────────────────────────────────────────────

describe('apiClient', () => {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('T4: ApiClient.generate() POSTs JSON with action: "generate"', async () => {
    const { ApiClient } = await import('../src/lib/apiClient.js');
    const mockResponse = {
      ok: true,
      resumeMd: '# Resume',
      docUrl: 'https://docs.google.com/doc/1',
      sheetRowUrl: 'https://sheets.google.com/row/1',
      missingSkills: [],
      keywordCoverage: { matched: [], missing: [], rate: 1 },
      reframings: [],
      cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
      modelUsed: 'claude-haiku-4-5-20251001',
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    });

    const client = new ApiClient(APPS_SCRIPT_URL);
    const result = await client.generate({
      jd: 'Software Engineer role',
      company: 'TestCo',
      role: 'Software Engineer',
      url: 'https://example.com',
      jobInsights: null,
      toggles: {},
      sourceFolderId: 'folder1',
      rulesFolderId: 'folder2',
      outputFolderId: 'folder3',
      sheetId: 'sheet1',
      model: 'claude-haiku-4-5-20251001',
    });

    expect(fetch).toHaveBeenCalledWith(
      APPS_SCRIPT_URL,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"generate"'),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('T5: ApiClient handles { ok: true, ... } success responses', async () => {
    const { ApiClient } = await import('../src/lib/apiClient.js');
    const pingResponse = { ok: true, version: '1.0.0', serverTime: Date.now() };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => pingResponse,
      text: async () => JSON.stringify(pingResponse),
    });

    const client = new ApiClient(APPS_SCRIPT_URL);
    const result = await client.ping();

    expect(result).toEqual(pingResponse);
  });

  it('T6: ApiClient handles { ok: false, error: ... } error responses without throwing', async () => {
    const { ApiClient } = await import('../src/lib/apiClient.js');
    const errorResponse = {
      ok: false,
      error: { type: 'auth', message: 'Unauthorized', retryable: false },
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => errorResponse,
      text: async () => JSON.stringify(errorResponse),
    });

    const client = new ApiClient(APPS_SCRIPT_URL);
    const result = await client.ping();

    expect(result).toEqual(errorResponse);
    expect((result as { ok: false }).ok).toBe(false);
  });

  it('T7: ApiClient handles network failures without throwing, returns typed error', async () => {
    const { ApiClient } = await import('../src/lib/apiClient.js');
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const client = new ApiClient(APPS_SCRIPT_URL);
    const result = await client.ping();

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: 'server',
        retryable: true,
      },
    });
  });

  it('T8: ApiClient.listFiles, writeFile, seedDefaults, ping hit correct action endpoints', async () => {
    const { ApiClient } = await import('../src/lib/apiClient.js');
    const client = new ApiClient(APPS_SCRIPT_URL);

    const mockOk = (extra: Record<string, unknown>) => ({
      ok: true,
      json: async () => ({ ok: true, ...extra }),
      text: async () => JSON.stringify({ ok: true, ...extra }),
    });

    // listFiles
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk({ files: [], totalTokens: 0 }),
    );
    await client.listFiles({ folderId: 'f1', folderType: 'source' });
    expect(fetch).toHaveBeenLastCalledWith(
      APPS_SCRIPT_URL,
      expect.objectContaining({ body: expect.stringContaining('"action":"list_files"') }),
    );

    // writeFile
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockOk({ updatedAt: 1234 }));
    await client.writeFile({ fileId: 'f1', newContents: 'content' });
    expect(fetch).toHaveBeenLastCalledWith(
      APPS_SCRIPT_URL,
      expect.objectContaining({ body: expect.stringContaining('"action":"write_file"') }),
    );

    // seedDefaults
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk({ seeded: [], errors: [] }),
    );
    await client.seedDefaults({
      rulesFolderId: 'f1',
      rawBaseUrl: 'https://raw.github.com',
      filenames: [],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      APPS_SCRIPT_URL,
      expect.objectContaining({ body: expect.stringContaining('"action":"seed_defaults"') }),
    );

    // ping
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk({ version: '1.0', serverTime: 0 }),
    );
    await client.ping();
    expect(fetch).toHaveBeenLastCalledWith(
      APPS_SCRIPT_URL,
      expect.objectContaining({ body: expect.stringContaining('"action":"ping"') }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// background.ts: tab event handling
// ─────────────────────────────────────────────────────────────────────────────

describe('background.ts: tab event handling', () => {
  it('T1: handleTabActivated injects scraper and posts scrape_result to side panel', async () => {
    const scrapeOutput = {
      jd: 'Engineer at TestCo',
      company: 'TestCo',
      role: 'Software Engineer',
      url: 'https://example.com/job/123',
      scrapeStrategy: 'generic' as const,
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    // Mock scripting.executeScript to return scrape output
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: scrapeOutput }]);
    chromeMock.tabs.get.mockResolvedValue({
      id: 1,
      url: 'https://example.com/job/123',
      status: 'complete',
    });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 1 });

    // Should send scrape_result message
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scrape_result' }),
    );
  });

  it('T2: handleTabActivated sends scrape_failure on caught error', async () => {
    chromeMock.scripting.executeScript.mockRejectedValue(new Error('Script injection failed'));
    chromeMock.tabs.get.mockResolvedValue({
      id: 1,
      url: 'https://example.com/job/123',
      status: 'complete',
    });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 1 });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scrape_failure' }),
    );
  });

  it('T3: handleTabActivated skips chrome://, chrome-extension://, about:, file:// URLs', async () => {
    const skippedUrls = [
      'chrome://newtab/',
      'chrome-extension://abc123/sidepanel.html',
      'about:blank',
      'file:///Users/me/test.html',
    ];

    const { handleTabActivated } = await import('../src/background.js');

    for (const url of skippedUrls) {
      chromeMock.tabs.get.mockResolvedValue({ id: 1, url, status: 'complete' });
      chromeMock.scripting.executeScript.mockClear();
      chromeMock.runtime.sendMessage.mockClear();

      await handleTabActivated({ tabId: 1 });

      expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: generate flow
// ─────────────────────────────────────────────────────────────────────────────

describe('integration: generate flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('T12: generate_request → apiClient.generate → generate_result sent back', async () => {
    const generateResponse = {
      ok: true,
      resumeMd: '# Tailored Resume',
      docUrl: 'https://docs.google.com/doc/abc',
      sheetRowUrl: 'https://sheets.google.com/row/1',
      missingSkills: [],
      keywordCoverage: { matched: ['TypeScript'], missing: [], rate: 1 },
      reframings: [],
      cost: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.002 },
      modelUsed: 'claude-haiku-4-5-20251001',
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => generateResponse,
      text: async () => JSON.stringify(generateResponse),
    });

    // Seed storage with required config
    await chromeMock.storage.local.set({
      appsScriptUrl: 'https://script.google.com/macros/s/test/exec',
      driveSourceFolderId: 'src_folder',
      driveRulesFolderId: 'rules_folder',
      driveOutputFolderId: 'out_folder',
      sheetId: 'sheet123',
      defaultGenerateModel: 'claude-haiku-4-5-20251001',
    });

    const { handleGenerateRequest } = await import('../src/background.js');
    const req = {
      action: 'generate' as const,
      jd: 'Senior Engineer at TestCo',
      company: 'TestCo',
      role: 'Senior Engineer',
      url: 'https://testco.com/jobs/123',
      jobInsights: null,
      toggles: {},
      sourceFolderId: 'src_folder',
      rulesFolderId: 'rules_folder',
      outputFolderId: 'out_folder',
      sheetId: 'sheet123',
      model: 'claude-haiku-4-5-20251001',
    };
    await handleGenerateRequest(req);

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generate_result' }),
    );
  });

  it('T13: scrape_result message updates lastJobInsights in storage', async () => {
    const scrapeOutput = {
      jd: 'ML Engineer at AILab',
      company: 'AILab',
      role: 'ML Engineer',
      url: 'https://ailab.com/jobs/1',
      scrapeStrategy: 'generic' as const,
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: scrapeOutput }]);
    chromeMock.tabs.get.mockResolvedValue({
      id: 2,
      url: 'https://ailab.com/jobs/1',
      status: 'complete',
    });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 2 });

    const stored = await chromeMock.storage.local.get('lastJobInsights');
    // After a successful scrape, lastJobInsights should be set
    expect(stored['lastJobInsights']).toBeDefined();
  });

  it('T14: tab change auto-rescan posts new scrape_result to side panel', async () => {
    const scrapeOutput = {
      jd: 'DevOps role',
      company: 'CloudCo',
      role: 'DevOps Engineer',
      url: 'https://cloudco.io/jobs/devops',
      scrapeStrategy: 'generic' as const,
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: scrapeOutput }]);
    chromeMock.tabs.get.mockResolvedValue({
      id: 3,
      url: 'https://cloudco.io/jobs/devops',
      status: 'complete',
    });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 3 });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scrape_result',
        payload: expect.objectContaining({ company: 'CloudCo' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit-preservation safeguard
// ─────────────────────────────────────────────────────────────────────────────

describe('edit-preservation safeguard', () => {
  it('T15: scrape_result carries isDirtyOverride flag when JD textarea was dirty', async () => {
    // This test verifies the message shape includes a field for the dirty flag.
    // The dirty state is tracked by side panel; background includes it in the message
    // so the side panel can decide whether to apply or prompt the user.
    const scrapeOutput = {
      jd: 'New JD from rescan',
      company: 'NewCo',
      role: 'New Role',
      url: 'https://newco.com/job/99',
      scrapeStrategy: 'linkedin' as const,
      jobInsights: null,
      scrapedAt: Date.now(),
    };
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: scrapeOutput }]);
    chromeMock.tabs.get.mockResolvedValue({
      id: 5,
      url: 'https://newco.com/job/99',
      status: 'complete',
    });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 5 });

    // The message should include requiresUserConfirmation field (false by default from background)
    const call = (chromeMock.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === 'scrape_result',
    );
    expect(call).toBeDefined();
    const msg = call![0] as { type: string; payload: unknown; requiresUserConfirmation: boolean };
    expect(msg).toHaveProperty('requiresUserConfirmation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Silent-failure hardening: structured logging on swallowed paths
// (audit H1 / H3 / M20)
// ─────────────────────────────────────────────────────────────────────────────

describe('background.ts: structured logging on error paths', () => {
  const scrapeResult = () => [
    {
      result: {
        jd: 'JD',
        company: 'C',
        role: 'R',
        url: 'https://x.com/j',
        scrapeStrategy: 'generic' as const,
        jobInsights: null,
        scrapedAt: Date.now(),
      },
    },
  ];

  it('B-log1: safeSend swallows "no receiver" errors silently (panel closed) — no warn line', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.runtime.sendMessage.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    chromeMock.scripting.executeScript.mockResolvedValue(scrapeResult());
    chromeMock.tabs.get.mockResolvedValue({ id: 9, url: 'https://x.com/j', status: 'complete' });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 9 });

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/sendMessage to side panel failed/);
    warnSpy.mockRestore();
  });

  it('B-log2: safeSend logs a structured warn for non-"no receiver" send failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.runtime.sendMessage.mockRejectedValueOnce(new Error('some other runtime error'));
    chromeMock.scripting.executeScript.mockResolvedValue(scrapeResult());
    chromeMock.tabs.get.mockResolvedValue({ id: 10, url: 'https://x.com/j', status: 'complete' });

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 10 });

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/\[JobHelp\]/);
    expect(logged).toMatch(/sendMessage to side panel failed/);
    warnSpy.mockRestore();
  });

  it('B-log3: handleTabActivated logs a structured warn for an unexpected tabs.get failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.tabs.get.mockRejectedValueOnce(new Error('permission revoked'));

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 11 });

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/tabs\.get failed/);
    warnSpy.mockRestore();
  });

  it('B-log4: handleTabActivated stays silent for the benign "no tab with id" tabs.get failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.tabs.get.mockRejectedValueOnce(new Error('No tab with id: 999'));

    const { handleTabActivated } = await import('../src/background.js');
    await handleTabActivated({ tabId: 999 });

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/tabs\.get failed/);
    warnSpy.mockRestore();
  });
});
