import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { err, ok, type Result } from '../types/result.js';

export interface StoreError {
  readonly type: 'io' | 'not_found';
  readonly message: string;
  readonly path?: string;
}

export interface ResumeFileInfo {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
}

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function resumePath(dir: string, name: string): string {
  return join(expandHome(dir), `${name}.md`);
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

export async function writeResumeFile(
  dir: string,
  name: string,
  content: string,
): Promise<Result<string, StoreError>> {
  const path = resumePath(dir, name);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return ok(path);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown write error';
    return err({ type: 'io', message, path });
  }
}

export async function readResumeFile(path: string): Promise<Result<string, StoreError>> {
  try {
    const content = await readFile(path, 'utf8');
    return ok(content);
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return err({ type: 'not_found', message: `resume file not found: ${path}`, path });
    }
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'io', message, path });
  }
}

export async function statResumeFile(path: string): Promise<Result<ResumeFileInfo, StoreError>> {
  try {
    const s = await stat(path);
    return ok({ path, size: s.size, modifiedAt: s.mtime.toISOString() });
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return err({ type: 'not_found', message: `resume file not found: ${path}`, path });
    }
    const message = e instanceof Error ? e.message : 'unknown stat error';
    return err({ type: 'io', message, path });
  }
}
