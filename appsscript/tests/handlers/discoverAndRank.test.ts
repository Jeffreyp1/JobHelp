/**
 * Tests for appsscript/src/handlers/discoverAndRank.ts
 *
 * Covers validateDiscoverAndRank + handleDiscoverAndRank.
 *
 * lib/jobDiscovery (discoverJobs/dedupJobs) and lib/jobRanking (rankJobs) are
 * mocked so the real (UrlFetchApp / Claude) impls aren't exercised — we control
 * their returns / throws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/jobDiscovery.js', () => ({
  discoverJobs: vi.fn(),
  dedupJobs: vi.fn(),
}));
vi.mock('../../src/lib/jobRanking.js', () => ({
  rankJobs: vi.fn(),
}));

import {
  validateDiscoverAndRank,
  handleDiscoverAndRank,
} from '../../src/handlers/discoverAndRank.js';
import { discoverJobs, dedupJobs } from '../../src/lib/jobDiscovery.js';
import { rankJobs } from '../../src/lib/jobRanking.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { Deps } from '../../src/Code.js';
import type { DriveOps } from '../../src/types/drive-ops.js';
import type { DiscoverAndRankRequest } from '../../src/types/api-contract.js';
import type { DiscoveredJob, JobProfile, RankedJob } from '../../src/types/job-discovery.js';

const discoverJobsMock = vi.mocked(discoverJobs);
const dedupJobsMock = vi.mocked(dedupJobs);
const rankJobsMock = vi.mocked(rankJobs);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<JobProfile> = {}): JobProfile {
  return {
    titles: ['Backend Engineer'],
    seniority: 'senior',
    skills: ['typescript', 'node'],
    domains: ['fintech'],
    searchQueries: ['backend engineer', 'node engineer'],
    filters: { remote: 'preferred', minSalary: null, locations: [] },
    summary: 'Backend.',
    ...overrides,
  };
}

function makeDiscovered(id: string): DiscoveredJob {
  return {
    id,
    source: 'greenhouse',
    company: 'Acme',
    title: 'Backend Engineer',
    location: 'Remote',
    remote: true,
    url: `https://example.com/${id}`,
    descriptionText: 'Build things with typescript and node.',
    postedAt: Date.now() - 86400000,
    discoveredAt: Date.now(),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  };
}

function makeRanked(id: string): RankedJob {
  return {
    ...makeDiscovered(id),
    keywordScore: 0.8,
    fitScore: null,
    recencyBoost: 0.95,
    finalScore: 0.76,
    matchedSkills: ['typescript', 'node'],
    missingSkills: [],
  };
}

function makeCost() {
  return {
    inputTokens: 500,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalUsd: 0.005,
  };
}

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  const notImpl = (name: string) => () => {
    throw new Error(`Drive.${name} should not be called by discoverAndRank handler`);
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

function makeRequest(overrides: Partial<DiscoverAndRankRequest> = {}): DiscoverAndRankRequest {
  return {
    action: 'discover_and_rank',
    profile: makeProfile(),
    config: { greenhouseBoards: ['acme'] },
    maxDaysOld: 14,
    topN: 10,
    sheetId: 'sheet-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  discoverJobsMock.mockReturnValue([makeDiscovered('a'), makeDiscovered('b'), makeDiscovered('a')]);
  dedupJobsMock.mockReturnValue([makeDiscovered('a'), makeDiscovered('b')]);
  rankJobsMock.mockReturnValue({ ranked: [makeRanked('a'), makeRanked('b')], cost: makeCost() });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateDiscoverAndRank', () => {
  function base(): Record<string, unknown> {
    return {
      action: 'discover_and_rank',
      profile: makeProfile(),
      config: { greenhouseBoards: ['acme'] },
      maxDaysOld: 14,
      topN: 10,
      sheetId: 'sheet-1',
    };
  }

  it('returns null for valid input', () => {
    expect(validateDiscoverAndRank(base())).toBeNull();
  });

  it('returns null when fitScoreModel present (non-empty string)', () => {
    expect(validateDiscoverAndRank({ ...base(), fitScoreModel: 'claude-haiku-4-5' })).toBeNull();
  });

  it('errors when profile missing', () => {
    const { profile, ...rest } = base();
    void profile;
    const err = validateDiscoverAndRank(rest);
    expect(err?.error.type).toBe('validation');
    expect(err?.error.message).toMatch(/profile/);
  });

  it('errors when profile not an object', () => {
    expect(validateDiscoverAndRank({ ...base(), profile: 'x' })?.error.type).toBe('validation');
  });

  it('errors when profile.skills not an array', () => {
    const err = validateDiscoverAndRank({ ...base(), profile: { ...makeProfile(), skills: 'nope' } });
    expect(err?.error.message).toMatch(/skills/);
  });

  it('errors when profile.searchQueries not an array', () => {
    const err = validateDiscoverAndRank({ ...base(), profile: { ...makeProfile(), searchQueries: 5 } });
    expect(err?.error.message).toMatch(/searchQueries/);
  });

  it('errors when config missing', () => {
    const { config, ...rest } = base();
    void config;
    expect(validateDiscoverAndRank(rest)?.error.message).toMatch(/config/);
  });

  it('errors when sheetId missing/empty', () => {
    expect(validateDiscoverAndRank({ ...base(), sheetId: '' })?.error.type).toBe('validation');
  });

  it('errors when maxDaysOld negative', () => {
    expect(validateDiscoverAndRank({ ...base(), maxDaysOld: -1 })?.error.message).toMatch(/maxDaysOld/);
  });

  it('errors when maxDaysOld not a number', () => {
    expect(validateDiscoverAndRank({ ...base(), maxDaysOld: '14' })?.error.type).toBe('validation');
  });

  it('errors when topN < 1', () => {
    expect(validateDiscoverAndRank({ ...base(), topN: 0 })?.error.message).toMatch(/topN/);
  });

  it('errors when fitScoreModel is empty string', () => {
    expect(validateDiscoverAndRank({ ...base(), fitScoreModel: '' })?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe('handleDiscoverAndRank', () => {
  it('happy path with sheet ops present: upserts rows, returns sheetUrl + jobs', () => {
    const upsert = vi.fn(() => ({ inserted: 2, updated: 0, sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1' }));
    const drive = makeDriveMock({ upsertJobPipelineRows: upsert });
    const deps = makeDeps(drive);

    const result = handleDiscoverAndRank(deps, makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.discoveredCount).toBe(2);
    expect(result.rankedCount).toBe(2);
    expect(result.jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(result.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/sheet-1');
    expect(result.cost.totalUsd).toBe(0.005);

    expect(discoverJobsMock).toHaveBeenCalledWith(
      { greenhouseBoards: ['acme'] },
      ['backend engineer', 'node engineer'],
    );
    expect(dedupJobsMock).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const callArgs = upsert.mock.calls[0] as unknown as [string, Array<Record<string, unknown>>];
    const sheetIdArg = callArgs[0];
    const rowsArg = callArgs[1];
    expect(sheetIdArg).toBe('sheet-1');
    expect(rowsArg).toHaveLength(2);
    expect(rowsArg[0]).toMatchObject({
      jobId: 'a',
      status: 'new',
      tailoredDocUrl: null,
      notes: '',
      finalScore: 0.76,
      matchedSkills: ['typescript', 'node'],
      missingSkills: [],
    });
  });

  it('happy path with sheet ops absent: sheetUrl="" and still ok:true', () => {
    const drive = makeDriveMock(); // no upsertJobPipelineRows
    const deps = makeDeps(drive);
    const result = handleDiscoverAndRank(deps, makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.sheetUrl).toBe('');
    expect(result.jobs.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('passes deps.claude to rankJobs only when fitScoreModel is set', () => {
    const deps = makeDeps(makeDriveMock());
    handleDiscoverAndRank(deps, makeRequest({ fitScoreModel: 'claude-haiku-4-5' }));
    expect(rankJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxDaysOld: 14, topN: 10, claude: deps.claude, fitScoreModel: 'claude-haiku-4-5' }),
    );
  });

  it('passes claude:undefined to rankJobs when no fitScoreModel', () => {
    const deps = makeDeps(makeDriveMock());
    handleDiscoverAndRank(deps, makeRequest());
    expect(rankJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ claude: undefined, fitScoreModel: undefined }),
    );
  });

  it('discovery throwing → typed server error, not a crash', () => {
    discoverJobsMock.mockImplementation(() => {
      throw new Error('network exploded');
    });
    const result = handleDiscoverAndRank(makeDeps(makeDriveMock()), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toMatch(/network exploded/);
  });

  it('ranking throwing ClaudeApiError → forwarded errorType', () => {
    rankJobsMock.mockImplementation(() => {
      throw new ClaudeApiError('rate_limit', 429, 'too fast');
    });
    const result = handleDiscoverAndRank(makeDeps(makeDriveMock()), makeRequest({ fitScoreModel: 'm' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('rate_limit');
    expect(result.error.retryable).toBe(true);
  });

  it('ranking throwing a plain Error → typed server error', () => {
    rankJobsMock.mockImplementation(() => {
      throw new Error('rank boom');
    });
    const result = handleDiscoverAndRank(makeDeps(makeDriveMock()), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
  });

  it('sheet upsert failure → driveError', () => {
    const drive = makeDriveMock({
      upsertJobPipelineRows: vi.fn(() => {
        throw new Error('Spreadsheet not found: sheet-1');
      }),
    });
    const result = handleDiscoverAndRank(makeDeps(drive), makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('drive');
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/Spreadsheet not found/);
  });

  it('returns validation error when called with bad input directly', () => {
    const result = handleDiscoverAndRank(makeDeps(makeDriveMock()), makeRequest({ topN: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
    expect(discoverJobsMock).not.toHaveBeenCalled();
  });
});
