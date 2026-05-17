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
import type { PersistedDigest } from '../../core/state/index.js';
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
