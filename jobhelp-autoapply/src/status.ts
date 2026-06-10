import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StatusRecord } from './types.ts';

export type StatusMap = Record<string, StatusRecord>;

function isErrno(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && Reflect.get(e, 'code') === code;
}

export async function loadStatuses(path: string): Promise<StatusMap> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e: unknown) {
    if (isErrno(e, 'ENOENT')) return {};
    throw new Error(`cannot read status sidecar ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never silently reset: an unreadable sidecar could otherwise drop a
    // 'submitted' record and let a job be submitted twice.
    throw new Error(`status sidecar ${path} is corrupt (invalid JSON); refusing to overwrite it`);
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as StatusMap) : {};
}

// Serialize writes per sidecar path. setStatus is read-modify-write, so two
// concurrent calls (parallel jobs) would otherwise both read the same snapshot
// and the later rename would clobber the earlier record — a lost update that
// could, e.g., drop a 'submitted' status and let a job be submitted twice.
const locks = new Map<string, Promise<unknown>>();
let tmpSeq = 0;

async function writeStatus(path: string, rec: StatusRecord): Promise<void> {
  const all = await loadStatuses(path);
  all[rec.jobId] = rec;
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.autoapply-status.${process.pid}.${tmpSeq++}.tmp`);
  await writeFile(tmp, JSON.stringify(all, null, 2));
  await rename(tmp, path);
}

export async function setStatus(path: string, rec: StatusRecord): Promise<void> {
  const prev = locks.get(path) ?? Promise.resolve();
  const next = prev.then(() => writeStatus(path, rec));
  locks.set(path, next.catch(() => undefined));
  await next;
}
