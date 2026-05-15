import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APPLICATION_KINDS,
  VERSIONED_KINDS,
  type ApplicationKind,
  type ApplicationVersion,
} from './index.js';

const VERSIONED_FILE_RE = /^(.+?)\.v(\d+)\.md$/;

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

export function fileNameForKind(kind: ApplicationKind, version: number): string {
  if (VERSIONED_KINDS.has(kind)) return `${kind}.v${version}.md`;
  return `${kind}.md`;
}

async function listKindFiles(dir: string, kind: ApplicationKind): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') return [];
    throw e;
  }
  const out: string[] = [];
  for (const name of entries) {
    const match = VERSIONED_FILE_RE.exec(name);
    if (match === null) continue;
    if (match[1] !== kind) continue;
    out.push(name);
  }
  return out;
}

export async function nextVersion(dir: string, kind: ApplicationKind): Promise<number> {
  if (!APPLICATION_KINDS.includes(kind)) {
    throw new Error(`unknown application kind: ${kind}`);
  }
  if (!VERSIONED_KINDS.has(kind)) return 1;
  const files = await listKindFiles(dir, kind);
  let max = 0;
  for (const file of files) {
    const match = VERSIONED_FILE_RE.exec(file);
    if (match === null) continue;
    const numText = match[2];
    if (numText === undefined) continue;
    const n = Number.parseInt(numText, 10);
    if (Number.isNaN(n)) continue;
    if (n > max) max = n;
  }
  return max + 1;
}

export async function listVersions(
  dir: string,
  kind: ApplicationKind,
): Promise<ApplicationVersion[]> {
  if (!VERSIONED_KINDS.has(kind)) {
    return [
      {
        version: 1,
        path: join(dir, fileNameForKind(kind, 1)),
        fileName: fileNameForKind(kind, 1),
      },
    ];
  }
  const files = await listKindFiles(dir, kind);
  const versions: ApplicationVersion[] = [];
  for (const file of files) {
    const match = VERSIONED_FILE_RE.exec(file);
    if (match === null) continue;
    const numText = match[2];
    if (numText === undefined) continue;
    const n = Number.parseInt(numText, 10);
    if (Number.isNaN(n)) continue;
    versions.push({ version: n, path: join(dir, file), fileName: file });
  }
  versions.sort((a, b) => a.version - b.version);
  return versions;
}
