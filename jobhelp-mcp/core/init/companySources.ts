import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const ashby = parseTokenBlock(parsed['ashby'], 'ashby');
  const breezy = parseTokenBlock(parsed['breezy'], 'breezy');
  const greenhouse = parseTokenBlock(parsed['greenhouse'], 'greenhouse');
  const lever = parseLeverBlock(parsed['lever']);
  const personio = parseTokenBlock(parsed['personio'], 'personio');
  const pinpoint = parseTokenBlock(parsed['pinpoint'], 'pinpoint');
  const recruitee = parseTokenBlock(parsed['recruitee'], 'recruitee');
  const smartrecruiters = parseTokenBlock(parsed['smartrecruiters'], 'smartrecruiters');
  const teamtailor = parseTokenBlock(parsed['teamtailor'], 'teamtailor');
  const workable = parseTokenBlock(parsed['workable'], 'workable');
  if (ashby !== undefined) out.ashby = ashby;
  if (breezy !== undefined) out.breezy = breezy;
  if (greenhouse !== undefined) out.greenhouse = greenhouse;
  if (lever !== undefined) out.lever = lever;
  if (personio !== undefined) out.personio = personio;
  if (pinpoint !== undefined) out.pinpoint = pinpoint;
  if (recruitee !== undefined) out.recruitee = recruitee;
  if (smartrecruiters !== undefined) out.smartrecruiters = smartrecruiters;
  if (teamtailor !== undefined) out.teamtailor = teamtailor;
  if (workable !== undefined) out.workable = workable;
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
