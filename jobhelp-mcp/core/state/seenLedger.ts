import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDigestsDir } from './digestStore.js';
import { identityKey } from '../pipeline/identity.js';
import { atomicWriteFile, type IoError } from '../lib/atomicWrite.js';
import { err, ok, type Result } from '../types/result.js';

const SEEN_LEDGER_FILE_NAME = 'seen.json';

export interface SeenLedgerEntry {
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly lastPostedAt?: string;
}

// identityKey -> aggregate sighting record.
export type SeenLedger = Readonly<Record<string, SeenLedgerEntry>>;

interface SeenJob {
  readonly company: string;
  readonly title: string;
  readonly postedAt?: string;
}

export function getSeenLedgerPath(): string {
  return join(getDigestsDir(), SEEN_LEDGER_FILE_NAME);
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

function parseEntry(raw: unknown): SeenLedgerEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const count = Reflect.get(raw, 'count');
  const firstSeen = Reflect.get(raw, 'firstSeen');
  const lastSeen = Reflect.get(raw, 'lastSeen');
  const lastPostedAt = Reflect.get(raw, 'lastPostedAt');
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  if (typeof firstSeen !== 'string' || typeof lastSeen !== 'string') return null;
  return {
    count,
    firstSeen,
    lastSeen,
    ...(typeof lastPostedAt === 'string' ? { lastPostedAt } : {}),
  };
}

export async function readSeenLedger(): Promise<Result<SeenLedger, IoError>> {
  const filePath = getSeenLedgerPath();
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') return ok({});
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'io', path: filePath, message });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return err({ type: 'io', path: filePath, message: `failed to parse seen ledger: ${message}` });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err({ type: 'io', path: filePath, message: 'seen ledger must be an object' });
  }
  const out: Record<string, SeenLedgerEntry> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = parseEntry(value);
    if (entry !== null) out[key] = entry;
  }
  return ok(out);
}

export async function updateSeenLedger(
  jobs: readonly SeenJob[],
  now: Date,
): Promise<Result<SeenLedger, IoError>> {
  const current = await readSeenLedger();
  if (!current.ok) return err(current.error);
  const nowIso = now.toISOString();
  const next: Record<string, SeenLedgerEntry> = { ...current.value };
  for (const job of jobs) {
    const key = identityKey(job.company, job.title);
    const prior = next[key];
    const lastPostedAt =
      job.postedAt !== undefined && job.postedAt.length > 0 ? job.postedAt : prior?.lastPostedAt;
    next[key] =
      prior === undefined
        ? {
            count: 1,
            firstSeen: nowIso,
            lastSeen: nowIso,
            ...(lastPostedAt !== undefined ? { lastPostedAt } : {}),
          }
        : {
            count: prior.count + 1,
            firstSeen: prior.firstSeen,
            lastSeen: nowIso,
            ...(lastPostedAt !== undefined ? { lastPostedAt } : {}),
          };
  }
  const dir = getDigestsDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'mkdir failed';
    return err({ type: 'io', path: dir, message });
  }
  const write = await atomicWriteFile(getSeenLedgerPath(), `${JSON.stringify(next, null, 2)}\n`);
  if (!write.ok) return err(write.error);
  return ok(next);
}
