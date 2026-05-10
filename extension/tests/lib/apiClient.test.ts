/**
 * Tests for ApiClient — all network methods.
 *
 * We stub globalThis.fetch via vi.stubGlobal so no real network calls are made.
 * The helper `mockFetch(body, ok?)` wires up a single response; each `it` block
 * restores mocks after itself via afterEach.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ApiClient } from '../../src/lib/apiClient';
import type {
  GenerateResponse,
  ListFilesResponse,
  WriteFileResponse,
  SeedDefaultsResponse,
  PingResponse,
  FinalizeResponse,
} from '../../src/types/api-contract.js';

const URL = 'https://script.google.com/macros/s/FAKE_ID/exec';

/** Helper: stub fetch to return a JSON body with HTTP 200 (or a non-ok status). */
function mockFetch(body: unknown, httpOk = true, status = httpOk ? 200 : 500) {
  const response = {
    ok: httpOk,
    status,
    statusText: httpOk ? 'OK' : 'Internal Server Error',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

/** Helper: stub fetch to throw a network-level error. */
function mockNetworkError(message = 'Failed to fetch') {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// generate
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.generate', () => {
  it('G1: POSTs JSON to the configured URL with action: "generate"', async () => {
    mockFetch({ ok: true, resumeMd: '# Resume', docUrl: '', jobFolderUrl: '', mdFileUrl: '', sheetRowUrl: '', missingSkills: [], keywordCoverage: { matched: [], missing: [], rate: 0 }, reframings: [], cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0 }, modelUsed: 'claude-haiku-4-5-20251001' } as GenerateResponse);

    const client = new ApiClient(URL);
    await client.generate({
      jd: 'Engineer role',
      company: 'Acme',
      role: 'SWE',
      url: 'https://jobs.acme.com/1',
      jobInsights: null,
      toggles: {},
      sourceFolderId: 'src',
      rulesFolderId: 'rules',
      outputFolderId: 'out',
      sheetId: 'sheet',
      model: 'claude-haiku-4-5-20251001',
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(URL);
    expect(calledInit.method).toBe('POST');
    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody.action).toBe('generate');
    expect(parsedBody.company).toBe('Acme');
  });

  it('G2: returns ok:true with result fields on success', async () => {
    const successBody: GenerateResponse = {
      ok: true,
      resumeMd: '# Resume',
      docUrl: 'https://docs.google.com/document/d/abc123/edit',
      jobFolderUrl: 'https://drive.google.com/folders/folder456',
      mdFileUrl: 'https://drive.google.com/file/md789',
      sheetRowUrl: 'https://sheets.google.com/sheet',
      missingSkills: ['Docker'],
      keywordCoverage: { matched: ['Python'], missing: ['Go'], rate: 0.5 },
      reframings: [],
      cost: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.008 },
      modelUsed: 'claude-haiku-4-5-20251001',
    };
    mockFetch(successBody);

    const client = new ApiClient(URL);
    const result = await client.generate({
      jd: 'test', company: null, role: null, url: '', jobInsights: null,
      toggles: {}, sourceFolderId: '', rulesFolderId: '', outputFolderId: '',
      sheetId: '', model: 'claude-haiku-4-5-20251001',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeMd).toBe('# Resume');
      expect(result.missingSkills).toContain('Docker');
    }
  });

  it('G3: returns ok:false on backend error response', async () => {
    const errBody: GenerateResponse = {
      ok: false,
      error: { type: 'server', message: 'Internal error', retryable: true },
    };
    mockFetch(errBody);

    const client = new ApiClient(URL);
    const result = await client.generate({
      jd: 'test', company: null, role: null, url: '', jobInsights: null,
      toggles: {}, sourceFolderId: '', rulesFolderId: '', outputFolderId: '',
      sheetId: '', model: 'claude-haiku-4-5-20251001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('server');
    }
  });

  it('G4: returns ok:false with retryable:true on network failure', async () => {
    mockNetworkError('net::ERR_INTERNET_DISCONNECTED');

    const client = new ApiClient(URL);
    const result = await client.generate({
      jd: 'test', company: null, role: null, url: '', jobInsights: null,
      toggles: {}, sourceFolderId: '', rulesFolderId: '', outputFolderId: '',
      sheetId: '', model: 'claude-haiku-4-5-20251001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
      expect(result.error.type).toBe('server');
    }
  });

  it('G5: returns ok:false with HTTP error status (non-2xx from proxy)', async () => {
    mockFetch({}, false, 503);

    const client = new ApiClient(URL);
    const result = await client.generate({
      jd: 'test', company: null, role: null, url: '', jobInsights: null,
      toggles: {}, sourceFolderId: '', rulesFolderId: '', outputFolderId: '',
      sheetId: '', model: 'claude-haiku-4-5-20251001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('503');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.listFiles', () => {
  it('L1: POSTs with action: "list_files" and the folder params', async () => {
    mockFetch({ ok: true, files: [], totalTokens: 0 } as ListFilesResponse);

    const client = new ApiClient(URL);
    await client.listFiles({ folderId: 'folder123', folderType: 'source' });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe('list_files');
    expect(body.folderId).toBe('folder123');
    expect(body.folderType).toBe('source');
  });

  it('L2: returns file list on success', async () => {
    const successBody: ListFilesResponse = {
      ok: true,
      files: [{ name: 'resume.md', fileId: 'f1', viewUrl: 'https://drive', tokens: 800, lastModifiedAt: 0 }],
      totalTokens: 800,
    };
    mockFetch(successBody);

    const client = new ApiClient(URL);
    const result = await client.listFiles({ folderId: 'f', folderType: 'rules' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files.length).toBe(1);
      expect(result.files[0].name).toBe('resume.md');
    }
  });

  it('L3: returns ok:false on backend error', async () => {
    mockFetch({ ok: false, error: { type: 'drive', message: 'Not found', retryable: false } } as ListFilesResponse);

    const client = new ApiClient(URL);
    const result = await client.listFiles({ folderId: 'bad', folderType: 'source' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('drive');
    }
  });

  it('L4: returns ok:false on network failure', async () => {
    mockNetworkError();

    const client = new ApiClient(URL);
    const result = await client.listFiles({ folderId: 'f', folderType: 'source' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// writeFile
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.writeFile', () => {
  it('W1: POSTs with action: "write_file", fileId, and newContents', async () => {
    mockFetch({ ok: true, updatedAt: 1700000000 } as WriteFileResponse);

    const client = new ApiClient(URL);
    await client.writeFile({ fileId: 'file99', newContents: '# Updated' });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe('write_file');
    expect(body.fileId).toBe('file99');
    expect(body.newContents).toBe('# Updated');
  });

  it('W2: returns ok:true with updatedAt on success', async () => {
    mockFetch({ ok: true, updatedAt: 1700000042 } as WriteFileResponse);

    const client = new ApiClient(URL);
    const result = await client.writeFile({ fileId: 'f', newContents: 'x' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedAt).toBe(1700000042);
    }
  });

  it('W3: returns ok:false on backend error', async () => {
    mockFetch({ ok: false, error: { type: 'auth', message: 'Unauthorized', retryable: false } } as WriteFileResponse);

    const client = new ApiClient(URL);
    const result = await client.writeFile({ fileId: 'f', newContents: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('auth');
    }
  });

  it('W4: returns ok:false on network failure', async () => {
    mockNetworkError('Connection refused');

    const client = new ApiClient(URL);
    const result = await client.writeFile({ fileId: 'f', newContents: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Connection refused');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// seedDefaults
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.seedDefaults', () => {
  it('S1: POSTs with action: "seed_defaults" and all fields', async () => {
    mockFetch({ ok: true, seeded: [], errors: [] } as SeedDefaultsResponse);

    const client = new ApiClient(URL);
    await client.seedDefaults({
      rulesFolderId: 'rules',
      rawBaseUrl: 'https://raw.github.com/user/repo/main/prompts/shared',
      filenames: ['01-priority.md', '02-tone.md'],
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe('seed_defaults');
    expect(body.rulesFolderId).toBe('rules');
    expect(body.filenames).toEqual(['01-priority.md', '02-tone.md']);
  });

  it('S2: returns seeded list on success', async () => {
    mockFetch({ ok: true, seeded: ['01-priority.md'], errors: [] } as SeedDefaultsResponse);

    const client = new ApiClient(URL);
    const result = await client.seedDefaults({ rulesFolderId: 'r', rawBaseUrl: 'u', filenames: ['01-priority.md'] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seeded).toContain('01-priority.md');
    }
  });

  it('S3: returns ok:false on backend error', async () => {
    mockFetch({ ok: false, error: { type: 'config', message: 'No rules folder', retryable: false } } as SeedDefaultsResponse);

    const client = new ApiClient(URL);
    const result = await client.seedDefaults({ rulesFolderId: '', rawBaseUrl: '', filenames: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('config');
    }
  });

  it('S4: returns ok:false on network failure', async () => {
    mockNetworkError();

    const client = new ApiClient(URL);
    const result = await client.seedDefaults({ rulesFolderId: 'r', rawBaseUrl: 'u', filenames: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ping
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.ping', () => {
  it('P1: POSTs with action: "ping"', async () => {
    mockFetch({ ok: true, version: '1.0.0', serverTime: 1700000000 } as PingResponse);

    const client = new ApiClient(URL);
    await client.ping();

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe('ping');
  });

  it('P2: returns version and serverTime on success', async () => {
    mockFetch({ ok: true, version: '2.3.1', serverTime: 1700000100 } as PingResponse);

    const client = new ApiClient(URL);
    const result = await client.ping();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('2.3.1');
      expect(result.serverTime).toBe(1700000100);
    }
  });

  it('P3: returns ok:false on network failure', async () => {
    mockNetworkError('DNS lookup failed');

    const client = new ApiClient(URL);
    const result = await client.ping();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('server');
    }
  });

  it('P4: returns ok:false with HTTP 404', async () => {
    mockFetch({}, false, 404);

    const client = new ApiClient(URL);
    const result = await client.ping();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('404');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finalize  (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiClient.finalize', () => {
  it('F1: POSTs JSON with action: "finalize" and all request fields', async () => {
    mockFetch({ ok: true, files: [] } as FinalizeResponse);

    const client = new ApiClient(URL);
    await client.finalize({
      docId: 'doc123',
      jobFolderId: 'folder456',
      finalMarkdown: '# My Resume',
      formats: ['pdf'],
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(URL);
    expect(calledInit.method).toBe('POST');
    const body = JSON.parse(calledInit.body as string);
    expect(body.action).toBe('finalize');
    expect(body.docId).toBe('doc123');
    expect(body.jobFolderId).toBe('folder456');
    expect(body.finalMarkdown).toBe('# My Resume');
    expect(body.formats).toEqual(['pdf']);
  });

  it('F2: returns { ok: true, files: [...] } on success', async () => {
    const successBody: FinalizeResponse = {
      ok: true,
      files: [
        { format: 'pdf', fileId: 'pdfFile1', url: 'https://drive.google.com/file/pdfFile1/view', fileName: 'tailored_resume.pdf' },
        { format: 'docx', fileId: 'docxFile2', url: 'https://drive.google.com/file/docxFile2/view', fileName: 'tailored_resume.docx' },
      ],
    };
    mockFetch(successBody);

    const client = new ApiClient(URL);
    const result = await client.finalize({
      docId: 'doc123',
      jobFolderId: 'folder456',
      finalMarkdown: '# Resume',
      formats: ['pdf', 'docx'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files.length).toBe(2);
      const pdfFile = result.files.find(f => f.format === 'pdf');
      expect(pdfFile).toBeDefined();
      expect(pdfFile?.fileName).toBe('tailored_resume.pdf');
      const docxFile = result.files.find(f => f.format === 'docx');
      expect(docxFile).toBeDefined();
    }
  });

  it('F3: surfaces { ok: false, error } on backend error response', async () => {
    const errBody: FinalizeResponse = {
      ok: false,
      error: { type: 'drive', message: 'Cannot export: folder not found', retryable: false },
    };
    mockFetch(errBody);

    const client = new ApiClient(URL);
    const result = await client.finalize({
      docId: 'doc123',
      jobFolderId: 'badFolder',
      finalMarkdown: '# Resume',
      formats: ['pdf'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('drive');
      expect(result.error.message).toContain('folder not found');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('F4: surfaces { ok: false, error: { type: "server", retryable: true } } on network failure', async () => {
    mockNetworkError('net::ERR_NAME_NOT_RESOLVED');

    const client = new ApiClient(URL);
    const result = await client.finalize({
      docId: 'doc123',
      jobFolderId: 'folder456',
      finalMarkdown: '# Resume',
      formats: ['docx'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('server');
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toContain('ERR_NAME_NOT_RESOLVED');
    }
  });

  it('F5: returns single-format file correctly (pdf only)', async () => {
    const successBody: FinalizeResponse = {
      ok: true,
      files: [
        { format: 'pdf', fileId: 'pdfOnly', url: 'https://drive.google.com/file/pdfOnly/view', fileName: 'resume.pdf' },
      ],
    };
    mockFetch(successBody);

    const client = new ApiClient(URL);
    const result = await client.finalize({
      docId: 'doc123',
      jobFolderId: 'folder456',
      finalMarkdown: '# Resume',
      formats: ['pdf'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files.length).toBe(1);
      expect(result.files[0].format).toBe('pdf');
    }
  });
});
