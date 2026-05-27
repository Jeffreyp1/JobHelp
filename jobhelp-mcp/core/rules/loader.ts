import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type Result } from '../types/result.js';
import type { RuleFile } from './merger.js';

export interface LoaderError {
  readonly type: 'io' | 'not_a_directory';
  readonly message: string;
  readonly path?: string;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

const PACKAGE_NAME = '@jeffreyp1/jobhelp-mcp';
const MAX_PACKAGE_ROOT_WALK = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function packageRoot(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_PACKAGE_ROOT_WALK; i += 1) {
    const candidate = join(dir, 'package.json');
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (parsed.name === PACKAGE_NAME) return dir;
    } catch (e: unknown) {
      const code = isRecord(e) ? e['code'] : undefined;
      if (code !== 'ENOENT') throw e;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

async function bundleDir(): Promise<string> {
  return join(await packageRoot(), 'prompts-bundle');
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

async function readMdDir(dir: string): Promise<Result<RuleFile[], LoaderError>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') return ok([]);
    if (getStringCode(e) === 'ENOTDIR') {
      return err({ type: 'not_a_directory', message: `not a directory: ${dir}`, path: dir });
    }
    const message = e instanceof Error ? e.message : 'unknown readdir error';
    return err({ type: 'io', message, path: dir });
  }

  const mdFiles = entries.filter((n) => n.endsWith('.md')).sort();
  const rules: RuleFile[] = [];
  for (const filename of mdFiles) {
    const full = join(dir, filename);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      const content = await readFile(full, 'utf8');
      rules.push({ id: filename.replace(/\.md$/, ''), filename, content });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown read error';
      return err({ type: 'io', message, path: full });
    }
  }
  return ok(rules);
}

export async function loadDefaults(): Promise<Result<readonly RuleFile[], LoaderError>> {
  const dir = await bundleDir();
  const result = await readMdDir(dir);
  if (!result.ok) return result;
  return ok(Object.freeze(result.value));
}

export async function loadUserRules(
  userDir: string,
): Promise<Result<readonly RuleFile[], LoaderError>> {
  const resolved = expandHome(userDir);
  const result = await readMdDir(resolved);
  if (!result.ok) return result;
  return ok(Object.freeze(result.value));
}
