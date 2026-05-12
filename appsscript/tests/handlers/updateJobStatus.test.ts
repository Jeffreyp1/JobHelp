/**
 * Tests for appsscript/src/handlers/updateJobStatus.ts
 *
 * Covers validateUpdateJobStatus + handleUpdateJobStatus, plus light coverage
 * of triggers.ts (installDailyJobDigest / runDailyJobDigest glue).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateUpdateJobStatus,
  handleUpdateJobStatus,
} from '../../src/handlers/updateJobStatus.js';
import { installDailyJobDigest, runDailyJobDigest } from '../../src/triggers.js';
import type { Deps } from '../../src/Code.js';
import type { DriveOps } from '../../src/types/drive-ops.js';
import type { UpdateJobStatusRequest } from '../../src/types/api-contract.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  const notImpl = (name: string) => () => {
    throw new Error(`Drive.${name} should not be called by updateJobStatus handler`);
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

function makeRequest(overrides: Partial<UpdateJobStatusRequest> = {}): UpdateJobStatusRequest {
  return {
    action: 'update_job_status',
    sheetId: 'sheet-1',
    jobId: 'greenhouse:acme:42',
    status: 'tailored',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateUpdateJobStatus', () => {
  function base(): Record<string, unknown> {
    return { action: 'update_job_status', sheetId: 'sheet-1', jobId: 'job-1', status: 'applied' };
  }

  it('returns null for valid input', () => {
    expect(validateUpdateJobStatus(base())).toBeNull();
  });

  it('returns null when tailoredDocUrl present (string)', () => {
    expect(validateUpdateJobStatus({ ...base(), tailoredDocUrl: 'https://drive/x' })).toBeNull();
  });

  it.each(['new', 'tailored', 'applied', 'rejected', 'closed'])('accepts valid status %s', (status) => {
    expect(validateUpdateJobStatus({ ...base(), status })).toBeNull();
  });

  it('errors when sheetId missing/empty', () => {
    expect(validateUpdateJobStatus({ ...base(), sheetId: '' })?.error.type).toBe('validation');
  });

  it('errors when jobId missing', () => {
    const { jobId, ...rest } = base();
    void jobId;
    expect(validateUpdateJobStatus(rest)?.error.message).toMatch(/jobId/);
  });

  it('errors when status is not a known value', () => {
    const err = validateUpdateJobStatus({ ...base(), status: 'archived' });
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/status/);
  });

  it('errors when status missing', () => {
    const { status, ...rest } = base();
    void status;
    expect(validateUpdateJobStatus(rest)?.error.type).toBe('validation');
  });

  it('errors when tailoredDocUrl is non-string', () => {
    expect(validateUpdateJobStatus({ ...base(), tailoredDocUrl: 5 })?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe('handleUpdateJobStatus', () => {
  it('happy path: calls updateJobPipelineStatus, returns updatedAt', () => {
    const update = vi.fn(() => ({ updatedAt: 1_700_000_000_000 }));
    const drive = makeDriveMock({ updateJobPipelineStatus: update });
    const result = handleUpdateJobStatus(makeDeps(drive), makeRequest({ tailoredDocUrl: 'https://drive/doc' }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.updatedAt).toBe(1_700_000_000_000);
    expect(update).toHaveBeenCalledWith('sheet-1', 'greenhouse:acme:42', 'tailored', 'https://drive/doc');
  });

  it('passes undefined tailoredDocUrl through when not provided', () => {
    const update = vi.fn(() => ({ updatedAt: 1 }));
    const drive = makeDriveMock({ updateJobPipelineStatus: update });
    handleUpdateJobStatus(makeDeps(drive), makeRequest());
    expect(update).toHaveBeenCalledWith('sheet-1', 'greenhouse:acme:42', 'tailored', undefined);
  });

  it('sheet ops absent → driveError', () => {
    const drive = makeDriveMock(); // no updateJobPipelineStatus
    const result = handleUpdateJobStatus(makeDeps(drive), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('drive');
    expect(result.error.message).toMatch(/sheet ops unavailable/i);
  });

  it('"no such row" error → typed drive error (retryable false)', () => {
    const drive = makeDriveMock({
      updateJobPipelineStatus: vi.fn(() => {
        throw new Error('No Job Pipeline row with jobId greenhouse:acme:42');
      }),
    });
    const result = handleUpdateJobStatus(makeDeps(drive), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('drive');
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/No Job Pipeline row/);
  });

  it('returns validation error when called with bad status directly', () => {
    const update = vi.fn();
    const drive = makeDriveMock({ updateJobPipelineStatus: update as unknown as DriveOps['updateJobPipelineStatus'] });
    const result = handleUpdateJobStatus(makeDeps(drive), makeRequest({ status: 'bogus' as UpdateJobStatusRequest['status'] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// triggers.ts (light coverage)
// ---------------------------------------------------------------------------

describe('triggers', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ScriptApp;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).PropertiesService;
  });

  it('installDailyJobDigest calls ScriptApp.newTrigger(...).timeBased().everyDays(1).atHour(7).create()', () => {
    const create = vi.fn();
    const atHour = vi.fn(() => ({ create }));
    const everyDays = vi.fn(() => ({ atHour }));
    const timeBased = vi.fn(() => ({ everyDays }));
    const newTrigger = vi.fn(() => ({ timeBased }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ScriptApp = { newTrigger };

    installDailyJobDigest();

    expect(newTrigger).toHaveBeenCalledWith('runDailyJobDigest');
    expect(everyDays).toHaveBeenCalledWith(1);
    expect(atHour).toHaveBeenCalledWith(7);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('installDailyJobDigest is a no-op when ScriptApp is undefined', () => {
    expect(() => installDailyJobDigest()).not.toThrow();
  });

  it('runDailyJobDigest with a missing config property logs-and-returns without throwing', () => {
    const getProperty = vi.fn(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).PropertiesService = { getScriptProperties: () => ({ getProperty }) };
    expect(() => runDailyJobDigest()).not.toThrow();
    expect(getProperty).toHaveBeenCalled();
  });

  it('runDailyJobDigest with PropertiesService undefined does not throw', () => {
    expect(() => runDailyJobDigest()).not.toThrow();
  });

  it('runDailyJobDigest with malformed JSON in the property does not throw', () => {
    const getProperty = vi.fn(() => 'not json {');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).PropertiesService = { getScriptProperties: () => ({ getProperty }) };
    expect(() => runDailyJobDigest()).not.toThrow();
  });
});
