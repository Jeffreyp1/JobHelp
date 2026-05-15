import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getStateFilePath,
  getStateRoot,
  readState,
  updateState,
  writeState,
} from '../../core/state/store.js';
import { EMPTY_STATE, STATE_SCHEMA_VERSION, type JobHelpState } from '../../core/state/index.js';
import { isErr, isOk } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-state-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('getStateRoot / getStateFilePath', () => {
  it('uses JOBHELP_HOME when set', () => {
    expect(getStateRoot()).toBe(sandbox);
    expect(getStateFilePath()).toBe(join(sandbox, 'state.json'));
  });

  it('falls back to ~/jobhelp when JOBHELP_HOME is unset', () => {
    delete process.env['JOBHELP_HOME'];
    expect(getStateRoot()).toMatch(/jobhelp$/);
  });
});

describe('readState', () => {
  it('returns EMPTY_STATE if state.json does not exist', async () => {
    const result = await readState();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(EMPTY_STATE);
    }
  });

  it('parses a valid state.json', async () => {
    const state: JobHelpState = {
      version: STATE_SCHEMA_VERSION,
      resumes: [
        {
          name: 'backend',
          path: '/tmp/backend.md',
          registeredAt: '2026-05-14T00:00:00.000Z',
          updatedAt: '2026-05-14T00:00:00.000Z',
        },
      ],
      activeResumeName: 'backend',
      applications: [],
      digests: [],
    };
    writeFileSync(join(sandbox, 'state.json'), JSON.stringify(state));
    const result = await readState();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(state);
    }
  });

  it('returns parse error on malformed JSON', async () => {
    writeFileSync(join(sandbox, 'state.json'), '{not json');
    const result = await readState();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('parse');
    }
  });

  it('returns validation error when activeResumeName is not in resumes', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({
        version: 1,
        resumes: [],
        activeResumeName: 'missing',
        applications: [],
        digests: [],
      }),
    );
    const result = await readState();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('returns validation error on wrong version', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({ version: 99, resumes: [], applications: [], digests: [] }),
    );
    const result = await readState();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('returns validation error when resumes is not array', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({ version: 1, resumes: {}, applications: [], digests: [] }),
    );
    const result = await readState();
    expect(isErr(result)).toBe(true);
  });
});

describe('writeState', () => {
  it('creates the directory and persists state', async () => {
    const state: JobHelpState = {
      version: STATE_SCHEMA_VERSION,
      resumes: [],
      applications: [
        {
          jobId: 'greenhouse:doordash:abc',
          company: 'DoorDash',
          role: 'SWE I',
          date: '2026-05-15',
          dir: '/tmp/x',
          createdAt: '2026-05-15T00:00:00.000Z',
          updatedAt: '2026-05-15T00:00:00.000Z',
        },
      ],
      digests: [],
    };
    const result = await writeState(state);
    expect(isOk(result)).toBe(true);
    const raw = readFileSync(join(sandbox, 'state.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(state);
  });

  it('writes atomically (no .tmp file left behind)', async () => {
    await writeState(EMPTY_STATE);
    const dirContents = readFileSync(join(sandbox, 'state.json'), 'utf8');
    expect(dirContents.length).toBeGreaterThan(0);
    const allTmpExist = readdirSync(sandbox).some((n: string) => n.includes('.tmp.'));
    expect(allTmpExist).toBe(false);
  });
});

describe('updateState', () => {
  it('runs mutator on read-modify-write cycle', async () => {
    const result = await updateState((state) => ({
      ...state,
      digests: [
        ...state.digests,
        { date: '2026-05-15', path: '/tmp/digest.json', jobCount: 5, createdAt: '2026-05-15T00:00:00.000Z' },
      ],
    }));
    expect(isOk(result)).toBe(true);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.digests).toHaveLength(1);
    }
  });

  it('serializes concurrent writes', async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      updateState((state) => ({
        ...state,
        digests: [
          ...state.digests,
          {
            date: `2026-05-${String(15 + i).padStart(2, '0')}`,
            path: `/tmp/${i}.json`,
            jobCount: i,
            createdAt: `2026-05-${String(15 + i).padStart(2, '0')}T00:00:00.000Z`,
          },
        ],
      })),
    );
    const results = await Promise.all(writes);
    expect(results.every((r) => r.ok)).toBe(true);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.digests).toHaveLength(5);
    }
  });

  it('returns lock_timeout when an existing lock blocks acquisition', async () => {
    mkdirSync(sandbox, { recursive: true });
    const lockPath = join(sandbox, 'state.json.lock');
    writeFileSync(lockPath, 'held');
    const result = await updateState((s) => s, { lockTimeoutMs: 50 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('lock_timeout');
    }
    rmSync(lockPath, { force: true });
  });

  it('releases the lock after a successful update', async () => {
    await updateState((s) => s);
    expect(existsSync(join(sandbox, 'state.json.lock'))).toBe(false);
  });
});
