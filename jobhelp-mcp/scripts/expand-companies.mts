import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../core/lib/log.js';
import { companyFromHnComment, filterNewCandidates, slugVariants } from './expand-companies-lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = dirname(HERE);
const COMPANY_LISTS_DIR = join(MCP_ROOT, 'company-lists');
const COMPANIES_ALL = join(HERE, 'companies-all.json');

const YC_URL = 'https://yc-oss.github.io/api/companies/all.json';
const HN_STORY_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=25';
const HN_COMMENTS_URL = (storyId: number, hits: number): string =>
  `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=${hits}`;

const VALIDATOR = 'npx tsx jobhelp-mcp/scripts/validate-ats-slugs.mts';

interface Args {
  readonly out: string;
  readonly from: readonly string[];
  readonly ycLimit: number | undefined;
  readonly hnComments: number;
  readonly max: number | undefined;
  readonly noYc: boolean;
  readonly noHn: boolean;
}

function fail(message: string): never {
  process.stderr.write(`${message}\nusage: ${VALIDATOR.replace('validate-ats-slugs', 'expand-companies')} --out candidates.json [--from names.json ...] [--yc-limit N] [--hn-comments N] [--max N] [--no-yc] [--no-hn]\n`);
  process.exit(1);
}

function parseInt_(name: string, raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n <= 0) fail(`${name} needs a positive integer`);
  return n;
}

function parseArgs(argv: readonly string[]): Args {
  let out: string | undefined;
  const from: string[] = [];
  let ycLimit: number | undefined;
  let hnComments = 1000;
  let max: number | undefined;
  let noYc = false;
  let noHn = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--out') out = argv[++i];
    else if (flag === '--from') {
      const v = argv[++i];
      if (v === undefined) fail('--from needs a file');
      from.push(v);
    } else if (flag === '--yc-limit') ycLimit = parseInt_('--yc-limit', argv[++i]);
    else if (flag === '--hn-comments') hnComments = parseInt_('--hn-comments', argv[++i]);
    else if (flag === '--max') max = parseInt_('--max', argv[++i]);
    else if (flag === '--no-yc') noYc = true;
    else if (flag === '--no-hn') noHn = true;
    else fail(`unknown flag: ${flag ?? ''}`);
  }
  if (out === undefined || out.length === 0) fail('--out is required');
  return { out, from, ycLimit, hnComments, max, noYc, noHn };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'jobhelp-company-miner/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function mineYc(limit: number | undefined): Promise<string[]> {
  const body = await fetchJson(YC_URL);
  if (!Array.isArray(body)) throw new Error('yc directory was not a JSON array');
  const names: string[] = [];
  for (const entry of body) {
    const name = isRecord(entry) ? asString(entry['name']) : undefined;
    if (name !== undefined) names.push(name);
    if (limit !== undefined && names.length >= limit) break;
  }
  return names;
}

async function newestWhoIsHiringStory(): Promise<number> {
  const body = await fetchJson(HN_STORY_URL);
  const hits = isRecord(body) ? body['hits'] : undefined;
  if (!Array.isArray(hits)) throw new Error('hn story search returned no hits');
  for (const hit of hits) {
    if (!isRecord(hit)) continue;
    const title = asString(hit['title']) ?? '';
    const id = Number(hit['objectID']);
    if (/who is hiring/i.test(title) && Number.isInteger(id)) return id;
  }
  throw new Error('no "who is hiring" story found in recent whoishiring posts');
}

async function mineHn(hnComments: number): Promise<{ storyId: number; names: string[] }> {
  const storyId = await newestWhoIsHiringStory();
  const body = await fetchJson(HN_COMMENTS_URL(storyId, hnComments));
  const hits = isRecord(body) ? body['hits'] : undefined;
  if (!Array.isArray(hits)) throw new Error('hn comment search returned no hits');
  const names: string[] = [];
  for (const hit of hits) {
    if (!isRecord(hit)) continue;
    if (Number(hit['parent_id']) !== storyId) continue;
    const text = asString(hit['comment_text']);
    if (text === undefined) continue;
    const company = companyFromHnComment(text);
    if (company !== undefined) names.push(company);
  }
  return { storyId, names };
}

async function mineFrom(files: readonly string[]): Promise<string[]> {
  const names: string[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`--from ${file} must be a JSON array of names`);
    for (const item of parsed) {
      const name = asString(item);
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

async function loadExistingTokens(): Promise<Set<string>> {
  const existing = new Set<string>();
  const addAll = (parsed: unknown): void => {
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      const token = asString(item);
      if (token !== undefined) existing.add(token.toLowerCase());
    }
  };
  const files = await readdir(COMPANY_LISTS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    addAll(JSON.parse(await readFile(join(COMPANY_LISTS_DIR, file), 'utf8')) as unknown);
  }
  try {
    addAll(JSON.parse(await readFile(COMPANIES_ALL, 'utf8')) as unknown);
  } catch (err) {
    log('warn', 'companies-all.json not readable; skipping', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return existing;
}

const args = parseArgs(process.argv.slice(2));

const rawNames: string[] = [];
let ycCount = 0;
let hnCount = 0;
let hnStory: number | undefined;

if (!args.noYc) {
  const yc = await mineYc(args.ycLimit);
  ycCount = yc.length;
  rawNames.push(...yc);
}
if (!args.noHn) {
  const hn = await mineHn(args.hnComments);
  hnCount = hn.names.length;
  hnStory = hn.storyId;
  rawNames.push(...hn.names);
}
if (args.from.length > 0) {
  rawNames.push(...(await mineFrom(args.from)));
}

const allVariants: string[] = [];
for (const name of rawNames) {
  for (const variant of slugVariants(name)) allVariants.push(variant);
}

const existing = await loadExistingTokens();
let candidates = filterNewCandidates(allVariants, existing);
if (args.max !== undefined) candidates = candidates.slice(0, args.max);

await writeFile(args.out, JSON.stringify(candidates, null, 2) + '\n', 'utf8');

log('info', 'company mining finished', {
  ycNames: ycCount,
  hnNames: hnCount,
  hnStory,
  fromNames: rawNames.length - ycCount - hnCount,
  rawVariants: allVariants.length,
  existingKnown: existing.size,
  newCandidates: candidates.length,
  out: args.out,
});

process.stderr.write(
  `\nwrote ${String(candidates.length)} new candidate slugs -> ${args.out}\n` +
    `validate them with the ATS prober, e.g.:\n` +
    `  ${VALIDATOR} --ats workable --candidates ${args.out} --out valid-workable.json --state workable-state.jsonl\n` +
    `  (repeat with --ats lever / --ats smartrecruiters)\n`,
);
