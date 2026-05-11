/**
 * Tests for appsscript/src/handlers/createDriveFile.ts
 *
 * Covers validateCreateDriveFile + handleCreateDriveFile.
 *
 * The handler depends only on deps.drive.createDriveFile — no Claude, no
 * CacheService — so we stub DriveOps via plain vi.fn() factories.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateCreateDriveFile,
  handleCreateDriveFile,
} from '../../src/handlers/createDriveFile.js';
import type { Deps } from '../../src/Code.js';
import type { DriveOps } from '../../src/types/drive-ops.js';
import type {
  CreateDriveFileRequest,
} from '../../src/types/api-contract.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  // We only ever exercise createDriveFile, but DriveOps is fully implemented
  // so TypeScript is satisfied. All other methods throw if accidentally hit
  // so a bug routing through the wrong call would surface loudly.
  const notImpl = (name: string) => () => {
    throw new Error(`Drive.${name} should not be called by createDriveFile handler`);
  };
  return {
    readSourceFiles: vi.fn(notImpl('readSourceFiles')),
    readRuleFiles: vi.fn(notImpl('readRuleFiles')),
    writeOutput: vi.fn(notImpl('writeOutput')) as unknown as DriveOps['writeOutput'],
    writeJobOutput: vi.fn(notImpl('writeJobOutput')) as unknown as DriveOps['writeJobOutput'],
    readFile: vi.fn(notImpl('readFile')) as unknown as DriveOps['readFile'],
    writeFile: vi.fn(notImpl('writeFile')) as unknown as DriveOps['writeFile'],
    seedDefaults: vi.fn(notImpl('seedDefaults')) as unknown as DriveOps['seedDefaults'],
    appendSheetRow: vi.fn(notImpl('appendSheetRow')) as unknown as DriveOps['appendSheetRow'],
    updateSheetRow: vi.fn(notImpl('updateSheetRow')) as unknown as DriveOps['updateSheetRow'],
    replaceDocContents: vi.fn(notImpl('replaceDocContents')) as unknown as DriveOps['replaceDocContents'],
    exportDocAs: vi.fn(notImpl('exportDocAs')) as unknown as DriveOps['exportDocAs'],
    downloadFileAsBase64: vi.fn(notImpl('downloadFileAsBase64')) as unknown as DriveOps['downloadFileAsBase64'],
    uploadDocxFromBase64: vi.fn(notImpl('uploadDocxFromBase64')) as unknown as DriveOps['uploadDocxFromBase64'],
    createFileInFolder: vi.fn(notImpl('createFileInFolder')) as unknown as DriveOps['createFileInFolder'],
    createDriveFile: vi.fn(
      (_fileName: string, _content: string, _mimeType: string, _parentFolderId?: string) => ({
        fileId: 'created-file-id',
        fileUrl: 'https://drive.google.com/file/d/created-file-id/view',
      }),
    ),
    createGoogleDoc: vi.fn(notImpl('createGoogleDoc')) as unknown as DriveOps['createGoogleDoc'],
    ...overrides,
  };
}

function makeDeps(drive: DriveOps): Deps {
  return {
    drive,
    // Claude + prompt are unused by this handler — stub minimal shape.
    claude: { call: vi.fn() },
    prompt: { composeSystemPrompt: vi.fn() },
  };
}

function makeRequest(
  overrides: Partial<CreateDriveFileRequest> = {},
): CreateDriveFileRequest {
  return {
    action: 'create_drive_file',
    fileName: 'jobhelp-config.json',
    content: JSON.stringify({ anthropicApiKey: 'sk-ant-stub' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validateCreateDriveFile', () => {
  it('returns null when minimal input is valid', () => {
    expect(
      validateCreateDriveFile({
        action: 'create_drive_file',
        fileName: 'jobhelp-config.json',
        content: '{}',
      }),
    ).toBeNull();
  });

  it('returns null when parentFolderId + mimeType also provided', () => {
    expect(
      validateCreateDriveFile({
        action: 'create_drive_file',
        fileName: 'jobhelp-config.json',
        content: '{}',
        parentFolderId: 'folder-123',
        mimeType: 'application/json',
      }),
    ).toBeNull();
  });

  it('errors when fileName is missing', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      content: '{}',
    });
    expect(err).not.toBeNull();
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/fileName/);
  });

  it('errors when fileName is empty string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: '',
      content: '{}',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when fileName is non-string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 42 as unknown,
      content: '{}',
    });
    expect(err?.error.type).toBe('validation');
  });

  it.each([
    ['back\\slash', '\\'],
    ['forward/slash', '/'],
    ['colon:bad', ':'],
    ['star*bad', '*'],
    ['question?bad', '?'],
    ['quote"bad', '"'],
    ['lt<bad', '<'],
    ['gt>bad', '>'],
    ['pipe|bad', '|'],
  ])('errors when fileName contains illegal character (%s)', (fileName, _char) => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName,
      content: '{}',
    });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/illegal characters/);
  });

  it('errors when content is missing', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'config.json',
    });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/content/);
  });

  it('errors when content is empty string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'config.json',
      content: '',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when content is non-string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'config.json',
      content: { not: 'a string' } as unknown,
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when content exceeds 1 MB', () => {
    // 1 MB + 1 byte of ASCII → 1 MB + 1 UTF-8 byte
    const oversized = 'a'.repeat(1024 * 1024 + 1);
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'huge.json',
      content: oversized,
    });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/size limit/i);
  });

  it('accepts content exactly at the 1 MB boundary', () => {
    const onLimit = 'a'.repeat(1024 * 1024);
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'onlimit.json',
      content: onLimit,
    });
    expect(err).toBeNull();
  });

  it('errors when parentFolderId is provided as empty string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'config.json',
      content: '{}',
      parentFolderId: '',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when mimeType is provided as empty string', () => {
    const err = validateCreateDriveFile({
      action: 'create_drive_file',
      fileName: 'config.json',
      content: '{}',
      mimeType: '',
    });
    expect(err?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

describe('handleCreateDriveFile', () => {
  it('happy path: creates file at Drive root with default JSON mime', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    const req = makeRequest({
      fileName: 'jobhelp-config.json',
      content: '{"hello":"world"}',
    });
    const result = handleCreateDriveFile(deps, req);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.fileId).toBe('created-file-id');
    expect(result.fileUrl).toBe(
      'https://drive.google.com/file/d/created-file-id/view',
    );

    expect(drive.createDriveFile).toHaveBeenCalledTimes(1);
    const args = (drive.createDriveFile as ReturnType<typeof vi.fn>).mock.calls[0];
    // Args: (fileName, content, mimeType, parentFolderId?)
    expect(args[0]).toBe('jobhelp-config.json');
    expect(args[1]).toBe('{"hello":"world"}');
    expect(args[2]).toBe('application/json'); // default mime
    expect(args[3]).toBeUndefined(); // root, not a folder
  });

  it('respects an explicit mimeType override', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    handleCreateDriveFile(deps, makeRequest({ mimeType: 'text/markdown' }));

    const args = (drive.createDriveFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[2]).toBe('text/markdown');
  });

  it('passes parentFolderId through when provided', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    const result = handleCreateDriveFile(
      deps,
      makeRequest({ parentFolderId: 'parent-folder-xyz' }),
    );

    expect(result.ok).toBe(true);
    const args = (drive.createDriveFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[3]).toBe('parent-folder-xyz');
  });

  it('drive failure returns driveError (retryable: false)', () => {
    const drive = makeDriveMock({
      createDriveFile: vi.fn(() => {
        throw new Error('Folder not found: parent-folder-xyz');
      }),
    });
    const deps = makeDeps(drive);

    const result = handleCreateDriveFile(
      deps,
      makeRequest({ parentFolderId: 'parent-folder-xyz' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('drive');
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/Folder not found/);
  });

  it('validation error: empty fileName never reaches drive', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    const result = handleCreateDriveFile(deps, makeRequest({ fileName: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(drive.createDriveFile).not.toHaveBeenCalled();
  });

  it('validation error: illegal fileName chars never reaches drive', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    const result = handleCreateDriveFile(
      deps,
      makeRequest({ fileName: 'bad/name.json' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(drive.createDriveFile).not.toHaveBeenCalled();
  });

  it('validation error: oversized content never reaches drive', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);

    const result = handleCreateDriveFile(
      deps,
      makeRequest({ content: 'a'.repeat(1024 * 1024 + 1) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(drive.createDriveFile).not.toHaveBeenCalled();
  });
});
