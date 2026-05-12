/**
 * Tests for appsscript/src/handlers/extractProfile.ts
 *
 * Covers validateExtractProfile + handleExtractProfile.
 *
 * The handler depends on deps.drive.readSourceFiles and lib/jobProfile's
 * distilProfile. We mock the lib module so the (real) distillation impl isn't
 * exercised — we control its return / throw directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/jobProfile.js', () => ({
  distilProfile: vi.fn(),
}));

import {
  validateExtractProfile,
  handleExtractProfile,
} from '../../src/handlers/extractProfile.js';
import { distilProfile } from '../../src/lib/jobProfile.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { Deps } from '../../src/Code.js';
import type { DriveOps } from '../../src/types/drive-ops.js';
import type { ExtractProfileRequest } from '../../src/types/api-contract.js';
import type { JobProfile } from '../../src/types/job-discovery.js';

const distilProfileMock = vi.mocked(distilProfile);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<JobProfile> = {}): JobProfile {
  return {
    titles: ['Senior Backend Engineer'],
    seniority: 'senior',
    skills: ['typescript', 'node', 'postgres'],
    domains: ['fintech'],
    searchQueries: ['senior backend engineer', 'node engineer'],
    filters: { remote: 'preferred', minSalary: 180000, locations: ['Remote'] },
    summary: 'Strong backend engineer.',
    ...overrides,
  };
}

function makeCost() {
  return {
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalUsd: 0.01,
  };
}

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  const notImpl = (name: string) => () => {
    throw new Error(`Drive.${name} should not be called by extractProfile handler`);
  };
  return {
    readSourceFiles: vi.fn(() => ({
      text: '=== resume.md ===\nA resume.',
      files: [],
      totalTokens: 5,
    })),
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
    createDriveFile: vi.fn(notImpl('createDriveFile')) as unknown as DriveOps['createDriveFile'],
    createGoogleDoc: vi.fn(notImpl('createGoogleDoc')) as unknown as DriveOps['createGoogleDoc'],
    ...overrides,
  };
}

function makeDeps(drive: DriveOps): Deps {
  return {
    drive,
    claude: { call: vi.fn() },
    prompt: { composeSystemPrompt: vi.fn() },
  };
}

function makeRequest(overrides: Partial<ExtractProfileRequest> = {}): ExtractProfileRequest {
  return {
    action: 'extract_profile',
    sourceFolderId: 'src-folder-1',
    model: 'claude-haiku-4-5',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  distilProfileMock.mockReturnValue({ profile: makeProfile(), cost: makeCost() });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateExtractProfile', () => {
  it('returns null for valid input', () => {
    expect(validateExtractProfile({ action: 'extract_profile', sourceFolderId: 'f', model: 'm' })).toBeNull();
  });

  it('errors when sourceFolderId missing', () => {
    const err = validateExtractProfile({ action: 'extract_profile', model: 'm' });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/sourceFolderId/);
  });

  it('errors when sourceFolderId empty', () => {
    const err = validateExtractProfile({ action: 'extract_profile', sourceFolderId: '', model: 'm' });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when sourceFolderId non-string', () => {
    const err = validateExtractProfile({ action: 'extract_profile', sourceFolderId: 5 as unknown, model: 'm' });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when model missing', () => {
    const err = validateExtractProfile({ action: 'extract_profile', sourceFolderId: 'f' });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/model/);
  });

  it('errors when model empty', () => {
    const err = validateExtractProfile({ action: 'extract_profile', sourceFolderId: 'f', model: '' });
    expect(err?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe('handleExtractProfile', () => {
  it('happy path: reads source files, distils, returns profile + cost', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);
    const result = handleExtractProfile(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.skills).toEqual(['typescript', 'node', 'postgres']);
    expect(result.cost.totalUsd).toBe(0.01);

    expect(drive.readSourceFiles).toHaveBeenCalledWith('src-folder-1');
    expect(distilProfileMock).toHaveBeenCalledTimes(1);
    expect(distilProfileMock).toHaveBeenCalledWith(deps.claude, 'claude-haiku-4-5', '=== resume.md ===\nA resume.');
  });

  it('returns validation error when called with bad input directly', () => {
    const drive = makeDriveMock();
    const deps = makeDeps(drive);
    const result = handleExtractProfile(deps, makeRequest({ sourceFolderId: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(drive.readSourceFiles).not.toHaveBeenCalled();
  });

  it('drive read failure → driveError (retryable false)', () => {
    const drive = makeDriveMock({
      readSourceFiles: vi.fn(() => {
        throw new Error('Folder not found: src-folder-1');
      }),
    });
    const deps = makeDeps(drive);
    const result = handleExtractProfile(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('drive');
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/Folder not found/);
    expect(distilProfileMock).not.toHaveBeenCalled();
  });

  it('ClaudeApiError from distilProfile is forwarded with errorType + retryable', () => {
    distilProfileMock.mockImplementation(() => {
      throw new ClaudeApiError('rate_limit', 429, 'slow down', 30);
    });
    const result = handleExtractProfile(makeDeps(makeDriveMock()), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('rate_limit');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toBe('slow down');
  });

  it('auth ClaudeApiError forwarded as auth, not collapsed', () => {
    distilProfileMock.mockImplementation(() => {
      throw new ClaudeApiError('auth', 401, 'bad key');
    });
    const result = handleExtractProfile(makeDeps(makeDriveMock()), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('auth');
    expect(result.error.retryable).toBe(false);
  });

  it('other thrown Error from distilProfile → type server, retryable true', () => {
    distilProfileMock.mockImplementation(() => {
      throw new Error('Claude returned invalid JSON');
    });
    const result = handleExtractProfile(makeDeps(makeDriveMock()), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toMatch(/invalid JSON/);
  });
});
