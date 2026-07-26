import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSeenLedgerPath,
  readSeenLedger,
  updateSeenLedger,
} from '../../core/state/seenLedger.js';
import { identityKey } from '../../core/pipeline/identity.js';
import { isOk } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-seen-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

const jobA = { company: 'Acme', title: 'Backend Engineer', postedAt: '2026-07-01T00:00:00.000Z' };
const jobB = { company: 'Globex', title: 'Platform Engineer' };

describe('readSeenLedger', () => {
  it('returns an empty ledger when the file is missing', async () => {
    const result = await readSeenLedger();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({});
    }
  });
});

describe('updateSeenLedger', () => {
  it('creates entries keyed by identityKey with count 1 on first sighting', async () => {
    const now = new Date('2026-07-20T10:00:00.000Z');
    const result = await updateSeenLedger([jobA, jobB], now);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const keyA = identityKey(jobA.company, jobA.title);
    const keyB = identityKey(jobB.company, jobB.title);
    expect(result.value[keyA]).toEqual({
      count: 1,
      firstSeen: '2026-07-20T10:00:00.000Z',
      lastSeen: '2026-07-20T10:00:00.000Z',
      lastPostedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(result.value[keyB]).toEqual({
      count: 1,
      firstSeen: '2026-07-20T10:00:00.000Z',
      lastSeen: '2026-07-20T10:00:00.000Z',
    });
  });

  it('increments count and advances lastSeen across updates, keeping firstSeen', async () => {
    await updateSeenLedger([jobA], new Date('2026-07-20T10:00:00.000Z'));
    await updateSeenLedger([jobA], new Date('2026-07-21T10:00:00.000Z'));
    const result = await readSeenLedger();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const entry = result.value[identityKey(jobA.company, jobA.title)];
    expect(entry?.count).toBe(2);
    expect(entry?.firstSeen).toBe('2026-07-20T10:00:00.000Z');
    expect(entry?.lastSeen).toBe('2026-07-21T10:00:00.000Z');
  });

  it('keeps the prior lastPostedAt when a later sighting has no postedAt', async () => {
    await updateSeenLedger([jobA], new Date('2026-07-20T10:00:00.000Z'));
    await updateSeenLedger(
      [{ company: jobA.company, title: jobA.title }],
      new Date('2026-07-21T10:00:00.000Z'),
    );
    const result = await readSeenLedger();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const entry = result.value[identityKey(jobA.company, jobA.title)];
    expect(entry?.lastPostedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('writes an atomic JSON object at <stateRoot>/digests/seen.json with no tmp leftovers', async () => {
    await updateSeenLedger([jobA], new Date('2026-07-20T10:00:00.000Z'));
    const path = getSeenLedgerPath();
    expect(path).toBe(join(sandbox, 'digests', 'seen.json'));
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([identityKey(jobA.company, jobA.title)]);
    const leftovers = readdirSync(join(sandbox, 'digests')).filter((n) => n.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });
});
