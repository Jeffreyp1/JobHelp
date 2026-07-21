import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { log } from '../lib/log.js';
import type { SourcesConfig } from '../types/config.js';

export const COMPANY_SOURCES_FILENAME = 'company-sources.json';

type TokenSource =
  | 'ashby'
  | 'breezy'
  | 'greenhouse'
  | 'personio'
  | 'pinpoint'
  | 'recruitee'
  | 'smartrecruiters'
  | 'teamtailor'
  | 'workable';

const PACKAGE_NAME = '@jeffreyp1/jobhelp-mcp';
const MAX_PACKAGE_ROOT_WALK = 8;

type MutableCompanySources = {
  ashby?: { tokens: string[] };
  breezy?: { tokens: string[] };
  greenhouse?: { tokens: string[] };
  lever?: { slugs: string[] };
  personio?: { tokens: string[] };
  pinpoint?: { tokens: string[] };
  recruitee?: { tokens: string[] };
  smartrecruiters?: { tokens: string[] };
  teamtailor?: { tokens: string[] };
  workable?: { tokens: string[] };
};

const TOKEN_SOURCE_FILES: Readonly<Record<TokenSource, string>> = {
  ashby: 'ashby.json',
  breezy: 'breezy.json',
  greenhouse: 'greenhouse.json',
  personio: 'personio.json',
  pinpoint: 'pinpoint.json',
  recruitee: 'recruitee.json',
  smartrecruiters: 'smartrecruiters.json',
  teamtailor: 'teamtailor.json',
  workable: 'workable.json',
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

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
      if (code !== 'ENOENT') {
        if (e instanceof SyntaxError) {
          throw new SyntaxError(`malformed package.json at ${candidate}: ${e.message}`);
        }
        throw e;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate ${PACKAGE_NAME}/package.json`);
}

async function readBundledList(root: string, file: string): Promise<string[]> {
  const raw = await readFile(join(root, 'company-lists', file), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isStringArray(parsed)) throw new Error(`company list ${file} must be a string array`);
  return parsed;
}

export function defaultCompanySourcesPath(configPath: string): string {
  return join(dirname(configPath), COMPANY_SOURCES_FILENAME);
}

export async function loadDefaultCompanySources(): Promise<SourcesConfig> {
  const root = await packageRoot();
  const out: {
    ashby?: { tokens: string[] };
    breezy?: { tokens: string[] };
    greenhouse?: { tokens: string[] };
    lever?: { slugs: string[] };
    personio?: { tokens: string[] };
    pinpoint?: { tokens: string[] };
    recruitee?: { tokens: string[] };
    smartrecruiters?: { tokens: string[] };
    teamtailor?: { tokens: string[] };
    workable?: { tokens: string[] };
  } = {};

  for (const [source, file] of Object.entries(TOKEN_SOURCE_FILES) as [TokenSource, string][]) {
    out[source] = { tokens: await readBundledList(root, file) };
  }
  out.lever = { slugs: await readBundledList(root, 'lever.json') };
  return out;
}

export async function writeDefaultCompanySourcesIfMissing(
  configPath: string,
): Promise<{ readonly path: string; readonly created: boolean }> {
  const path = defaultCompanySourcesPath(configPath);
  try {
    await access(path, constants.F_OK);
    return { path, created: false };
  } catch {
    const sources = await loadDefaultCompanySources();
    await writeFile(path, JSON.stringify(sources, null, 2) + '\n', 'utf8');
    return { path, created: true };
  }
}

interface SourceDelta {
  readonly before: number;
  readonly after: number;
  readonly added: number;
}

function unionPreserveOrder(base: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of base) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of additions) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function mergeSource(
  existing: readonly string[] | undefined,
  bundled: readonly string[],
): { readonly merged: string[]; readonly delta: SourceDelta } {
  const existingArr = existing ?? [];
  const merged = unionPreserveOrder(existingArr, bundled);
  return {
    merged,
    delta: { before: existingArr.length, after: merged.length, added: merged.length - existingArr.length },
  };
}

export async function loadCompanySourcesForConfig(
  configPath: string,
): Promise<SourcesConfig | undefined> {
  const path = defaultCompanySourcesPath(configPath);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e: unknown) {
    const code = isRecord(e) ? e['code'] : undefined;
    if (code === 'ENOENT') return undefined;
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error(`${COMPANY_SOURCES_FILENAME} must contain an object`);

  const userAshby = parseTokenBlock(parsed['ashby'], 'ashby');
  const userBreezy = parseTokenBlock(parsed['breezy'], 'breezy');
  const userGreenhouse = parseTokenBlock(parsed['greenhouse'], 'greenhouse');
  const userLever = parseLeverBlock(parsed['lever']);
  const userPersonio = parseTokenBlock(parsed['personio'], 'personio');
  const userPinpoint = parseTokenBlock(parsed['pinpoint'], 'pinpoint');
  const userRecruitee = parseTokenBlock(parsed['recruitee'], 'recruitee');
  const userSmartrecruiters = parseTokenBlock(parsed['smartrecruiters'], 'smartrecruiters');
  const userTeamtailor = parseTokenBlock(parsed['teamtailor'], 'teamtailor');
  const userWorkable = parseTokenBlock(parsed['workable'], 'workable');

  const bundled = await loadDefaultCompanySources();

  const out: MutableCompanySources = {};
  const deltas: Record<string, SourceDelta> = {};

  const tokenMerges: readonly [TokenSource, { tokens: string[] } | undefined][] = [
    ['ashby', userAshby],
    ['breezy', userBreezy],
    ['greenhouse', userGreenhouse],
    ['personio', userPersonio],
    ['pinpoint', userPinpoint],
    ['recruitee', userRecruitee],
    ['smartrecruiters', userSmartrecruiters],
    ['teamtailor', userTeamtailor],
    ['workable', userWorkable],
  ];
  for (const [source, userBlock] of tokenMerges) {
    const { merged, delta } = mergeSource(userBlock?.tokens, bundled[source]?.tokens ?? []);
    out[source] = { tokens: merged };
    if (delta.added > 0) deltas[source] = delta;
  }

  const { merged: leverMerged, delta: leverDelta } = mergeSource(
    userLever?.slugs,
    bundled.lever?.slugs ?? [],
  );
  out.lever = { slugs: leverMerged };
  if (leverDelta.added > 0) deltas['lever'] = leverDelta;

  if (Object.keys(deltas).length > 0) {
    log('info', 'company-sources union merge added bundled tokens', { path, deltas });
    const updated: Record<string, unknown> = { ...parsed };
    for (const [source] of tokenMerges) updated[source] = { tokens: out[source]?.tokens ?? [] };
    updated['lever'] = { slugs: out.lever.slugs };
    const written = await atomicWriteFile(path, JSON.stringify(updated, null, 2) + '\n');
    if (!written.ok) {
      log('warn', 'failed to persist company-sources union merge', {
        path,
        error: written.error.message,
      });
    }
  }

  return out;
}

function parseTokenBlock(value: unknown, source: string): { tokens: string[] } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isStringArray(value['tokens'])) {
    throw new Error(`${COMPANY_SOURCES_FILENAME}.${source}.tokens must be a string array`);
  }
  return { tokens: value['tokens'] };
}

function parseLeverBlock(value: unknown): { slugs: string[] } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isStringArray(value['slugs'])) {
    throw new Error(`${COMPANY_SOURCES_FILENAME}.lever.slugs must be a string array`);
  }
  return { slugs: value['slugs'] };
}
