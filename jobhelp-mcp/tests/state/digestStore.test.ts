import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDigestPath,
  getDigestsDir,
  getLatestDigest,
  getLatestPointerPath,
  persistDigest,
  readDigest,
} from '../../core/state/digestStore.js';
import { readState } from '../../core/state/store.js';
import { appliedJobIds } from '../../core/pipeline/history.js';
import type { ApplicationEntry, PersistedDigest } from '../../core/state/index.js';
import { isErr, isOk } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

const FIXTURE_DIGEST: PersistedDigest = {
  date: '2026-05-15',
  generatedAt: '2026-05-15T13:00:00.000Z',
  totalDurationMs: 4200,
  sourceResults: [
    { source: 'adzuna', jobCount: 12, durationMs: 1100 },
    {
      source: 'greenhouse',
      jobCount: 0,
      durationMs: 300,
      error: { type: 'auth', message: 'missing token' },
    },
  ],
  jobs: [
    {
      rank: 1,
      score: 0.87,
      job: {
        id: 'adzuna:abc123',
        source: 'adzuna',
        url: 'https://example.com/a',
        title: 'Software Engineer I',
        company: 'Acme',
        location: 'Remote (US)',
        remote: 'remote',
        description: 'Build cool things.',
        salaryMin: 130000,
        salaryMax: 180000,
        salaryCurrency: 'USD',
        postedAt: '2026-05-13T00:00:00.000Z',
      },
      breakdown: { keywordOverlap: 0.7, recencyBoost: 0.95, bm25f: 0.7 },
    },
  ],
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-digest-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('path helpers', () => {
  it('getDigestsDir is $JOBHELP_HOME/digests', () => {
    expect(getDigestsDir()).toBe(join(sandbox, 'digests'));
  });

  it('getDigestPath embeds the date', () => {
    expect(getDigestPath('2026-05-15')).toBe(
      join(sandbox, 'digests', 'digest-2026-05-15.json'),
    );
  });

  it('getLatestPointerPath is digests/latest.json', () => {
    expect(getLatestPointerPath()).toBe(join(sandbox, 'digests', 'latest.json'));
  });
});

describe('persistDigest', () => {
  it('writes the dated file and the latest pointer with identical contents', async () => {
    const result = await persistDigest(FIXTURE_DIGEST);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const datedRaw = readFileSync(result.value.path, 'utf8');
    const latestRaw = readFileSync(result.value.latestPath, 'utf8');
    expect(datedRaw).toBe(latestRaw);
    expect(JSON.parse(datedRaw)).toEqual(FIXTURE_DIGEST);
  });

  it('writes markdown and csv artifacts and records digest history in state', async () => {
    const result = await persistDigest(FIXTURE_DIGEST);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(readFileSync(result.value.markdownPath, 'utf8')).toContain(
      '# JobHelp daily digest - 2026-05-15',
    );
    expect(readFileSync(result.value.csvPath, 'utf8')).toContain(
      'rank,score,source,company,title',
    );
    const state = await readState();
    expect(isOk(state)).toBe(true);
    if (isOk(state)) {
      expect(state.value.digests).toEqual([
        {
          date: '2026-05-15',
          path: result.value.path,
          jobCount: 1,
          createdAt: '2026-05-15T13:00:00.000Z',
        },
      ]);
    }
  });

  it('overwrites the dated file when called twice for the same day', async () => {
    const first = await persistDigest({ ...FIXTURE_DIGEST, totalDurationMs: 1000 });
    expect(isOk(first)).toBe(true);
    const second = await persistDigest({ ...FIXTURE_DIGEST, totalDurationMs: 9999 });
    expect(isOk(second)).toBe(true);
    const raw = readFileSync(getDigestPath(FIXTURE_DIGEST.date), 'utf8');
    expect(JSON.parse(raw).totalDurationMs).toBe(9999);
  });

  it('updates latest.json to mirror today’s digest', async () => {
    await persistDigest({ ...FIXTURE_DIGEST, date: '2026-05-14', totalDurationMs: 1 });
    await persistDigest({ ...FIXTURE_DIGEST, date: '2026-05-15', totalDurationMs: 2 });
    const latestRaw = readFileSync(getLatestPointerPath(), 'utf8');
    expect(JSON.parse(latestRaw).date).toBe('2026-05-15');
    expect(JSON.parse(latestRaw).totalDurationMs).toBe(2);
  });

  it('rejects a malformed date', async () => {
    const result = await persistDigest({ ...FIXTURE_DIGEST, date: '2026/05/15' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('renders the already-applied marker for a job matching an application (company+title, different jobId/url)', async () => {
    const app: ApplicationEntry = {
      jobId: 'greenhouse:different',
      company: 'acme',
      role: 'Engineer I Software',
      date: '2026-05-10',
      dir: '/tmp/apps/acme',
      url: 'https://elsewhere.example/xyz',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    };
    const applied = appliedJobIds(FIXTURE_DIGEST.jobs.map((r) => r.job), [app]);
    expect(applied.has('adzuna:abc123')).toBe(true);
    const result = await persistDigest(FIXTURE_DIGEST, { appliedJobIds: applied });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(readFileSync(result.value.markdownPath, 'utf8')).toContain(
      '- **Status:** already applied',
    );
  });

  it('accepts appliedJobIds as a plain string array', async () => {
    const result = await persistDigest(FIXTURE_DIGEST, {
      appliedJobIds: ['adzuna:abc123'],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(readFileSync(result.value.markdownPath, 'utf8')).toContain('already applied');
  });

  it('does not persist appliedJobIds into the digest JSON (formatter meta only)', async () => {
    const result = await persistDigest(FIXTURE_DIGEST, {
      appliedJobIds: ['adzuna:abc123'],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const json = JSON.parse(readFileSync(result.value.path, 'utf8'));
    expect(json).toEqual(FIXTURE_DIGEST);
    expect('appliedJobIds' in json).toBe(false);
  });
});

describe('readDigest', () => {
  it('round-trips through persistDigest', async () => {
    await persistDigest(FIXTURE_DIGEST);
    const result = await readDigest(FIXTURE_DIGEST.date);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(FIXTURE_DIGEST);
    }
  });

  it('round-trips breakdown.rerank and breakdown.historyBoost', async () => {
    const base = FIXTURE_DIGEST.jobs[0];
    if (base === undefined) throw new Error('fixture missing job');
    const digest: PersistedDigest = {
      ...FIXTURE_DIGEST,
      jobs: [
        { ...base, breakdown: { ...base.breakdown, rerank: 0.93, historyBoost: 1.1 } },
      ],
    };
    await persistDigest(digest);
    const result = await readDigest(digest.date);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.jobs[0]?.breakdown.rerank).toBe(0.93);
      expect(result.value.jobs[0]?.breakdown.historyBoost).toBe(1.1);
    }
  });

  it('returns not_found when date has no digest', async () => {
    const result = await readDigest('2099-12-31');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('not_found');
    }
  });

  it('returns parse error on corrupt JSON', async () => {
    mkdirSync(join(sandbox, 'digests'), { recursive: true });
    writeFileSync(join(sandbox, 'digests', 'digest-2026-05-15.json'), '{bad');
    const result = await readDigest('2026-05-15');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('parse');
    }
  });

  it('returns validation error on missing required field', async () => {
    mkdirSync(join(sandbox, 'digests'), { recursive: true });
    writeFileSync(
      join(sandbox, 'digests', 'digest-2026-05-15.json'),
      JSON.stringify({ date: '2026-05-15' }),
    );
    const result = await readDigest('2026-05-15');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('rejects malformed date input', async () => {
    const result = await readDigest('2026/05/15');
    expect(isErr(result)).toBe(true);
  });
});

describe('getLatestDigest', () => {
  it('returns not_found when no digest exists yet', async () => {
    const result = await getLatestDigest();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('not_found');
    }
  });

  it('returns the most recently persisted digest', async () => {
    await persistDigest({ ...FIXTURE_DIGEST, date: '2026-05-14' });
    await persistDigest({ ...FIXTURE_DIGEST, date: '2026-05-15' });
    const result = await getLatestDigest();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.date).toBe('2026-05-15');
    }
  });

  it('persistDigest is idempotent across runs', async () => {
    await persistDigest(FIXTURE_DIGEST);
    expect(existsSync(getLatestPointerPath())).toBe(true);
    await persistDigest(FIXTURE_DIGEST);
    expect(existsSync(getLatestPointerPath())).toBe(true);
  });
});
