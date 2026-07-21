import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from '../core/lib/log.js';
import {
  SlugValidateError,
  buildOutput,
  createTokenBucket,
  dedupeCandidates,
  extractSlugs,
  isAtsKind,
  parseStateLines,
  parseVerdict,
  retryDelayMs,
  stateKey,
  type AtsKind,
  type SlugVerdict,
} from './lib/slug-validate.js';

interface CliArgs {
  readonly ats: AtsKind;
  readonly candidates: readonly string[];
  readonly out: string;
  readonly state: string;
  readonly rps: number;
  readonly concurrency: number;
  readonly limit: number | undefined;
}

const USAGE =
  'usage: npx tsx jobhelp-mcp/scripts/validate-ats-slugs.mts --ats workable|lever|smartrecruiters ' +
  '--candidates <file.json ...> --out <valid.json> --state <state.jsonl> [--rps 8] [--concurrency 8] [--limit N]';

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(1);
}

function parsePositiveInt(name: string, raw: string | undefined): number {
  if (raw === undefined) fail(`${name} requires a value`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) fail(`${name} must be a positive integer, got: ${raw}`);
  return n;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let ats: AtsKind | undefined;
  const candidates: string[] = [];
  let out: string | undefined;
  let state: string | undefined;
  let rps = 8;
  let concurrency = 8;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--ats') {
      const v = argv[++i];
      if (!isAtsKind(v)) fail(`--ats must be workable|lever|smartrecruiters, got: ${v ?? ''}`);
      ats = v;
    } else if (flag === '--candidates') {
      for (let next = argv[i + 1]; next !== undefined && !next.startsWith('--'); next = argv[i + 1]) {
        candidates.push(next);
        i++;
      }
    } else if (flag === '--out') {
      out = argv[++i];
    } else if (flag === '--state') {
      state = argv[++i];
    } else if (flag === '--rps') {
      rps = parsePositiveInt('--rps', argv[++i]);
    } else if (flag === '--concurrency') {
      concurrency = parsePositiveInt('--concurrency', argv[++i]);
    } else if (flag === '--limit') {
      limit = parsePositiveInt('--limit', argv[++i]);
    } else {
      fail(`unknown flag: ${flag ?? ''}`);
    }
  }
  if (ats === undefined) fail('--ats is required');
  if (candidates.length === 0) fail('--candidates requires at least one file');
  if (out === undefined || out.length === 0) fail('--out is required');
  if (state === undefined || state.length === 0) fail('--state is required');
  return { ats, candidates, out, state, rps, concurrency, limit };
}

function loadCandidates(files: readonly string[]): readonly string[] {
  const lists = files.map((file) => {
    if (!existsSync(file)) fail(`candidates file not found: ${file}`);
    return extractSlugs(JSON.parse(readFileSync(file, 'utf8')), file);
  });
  return dedupeCandidates(lists);
}

function probeUrl(ats: AtsKind, slug: string): string {
  const enc = encodeURIComponent(slug);
  if (ats === 'workable') return `https://apply.workable.com/api/v1/widget/accounts/${enc}`;
  if (ats === 'lever') return `https://api.lever.co/v0/postings/${enc}?mode=json`;
  return `https://api.smartrecruiters.com/v1/companies/${enc}/postings`;
}

const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 20000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function probeOne(
  ats: AtsKind,
  slug: string,
  acquire: () => Promise<void>,
): Promise<SlugVerdict> {
  const url = probeUrl(ats, slug);
  for (let attempt = 0; ; attempt++) {
    await acquire();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'jobhelp-slug-validator/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw new SlugValidateError('bad_response', 'network failure after retries', {
          ats,
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await sleep(retryDelayMs(null, attempt, Date.now()));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new SlugValidateError('bad_response', 'retryable status persisted after retries', {
          ats,
          slug,
          status: res.status,
        });
      }
      await sleep(retryDelayMs(res.headers.get('retry-after'), attempt, Date.now()));
      continue;
    }
    const body = res.status === 200 ? await res.text() : '';
    return parseVerdict(ats, slug, res.status, body);
  }
}

const args = parseArgs(process.argv.slice(2));

const allCandidates = loadCandidates(args.candidates);
const priorState = existsSync(args.state)
  ? parseStateLines(readFileSync(args.state, 'utf8'))
  : { verdicts: new Map<string, SlugVerdict>(), malformed: 0 };
if (priorState.malformed > 0) {
  log('warn', 'skipped malformed state lines', { state: args.state, malformed: priorState.malformed });
}

const verdicts = priorState.verdicts;
const pending = allCandidates.filter((slug) => !verdicts.has(stateKey(args.ats, slug)));
const queue = args.limit !== undefined ? pending.slice(0, args.limit) : pending;

log('info', 'slug probe starting', {
  ats: args.ats,
  candidates: allCandidates.length,
  alreadyStated: allCandidates.length - pending.length,
  toProbe: queue.length,
  rps: args.rps,
  concurrency: args.concurrency,
});

mkdirSync(dirname(args.state), { recursive: true });

let probed = 0;
let valid = 0;
let invalid = 0;
let failed = 0;
let interrupted = false;

function recordVerdict(v: SlugVerdict): void {
  appendFileSync(args.state, JSON.stringify(v) + '\n');
  verdicts.set(stateKey(v.ats, v.slug), v);
  if (v.valid) valid += 1;
  else invalid += 1;
}

function writeOut(): void {
  const rows = buildOutput(verdicts.values(), args.ats);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(rows, null, 2) + '\n');
  log('info', 'wrote valid slugs', { out: args.out, validSlugs: rows.length });
}

process.on('SIGINT', () => {
  interrupted = true;
  log('warn', 'interrupted — state is flushed per verdict; writing partial output', {
    probed,
    valid,
    invalid,
    failed,
  });
  writeOut();
  process.exit(130);
});

const bucket = createTokenBucket(args.rps);
let nextIndex = 0;

async function worker(): Promise<void> {
  for (;;) {
    if (interrupted) return;
    const slug = queue[nextIndex];
    nextIndex += 1;
    if (slug === undefined) return;
    try {
      recordVerdict(await probeOne(args.ats, slug, () => bucket.acquire()));
    } catch (err) {
      failed += 1;
      const ctx =
        err instanceof SlugValidateError
          ? { slug, ...err.ctx, kind: err.kind, message: err.message }
          : { slug, error: err instanceof Error ? err.message : String(err) };
      log('warn', 'probe failed; slug left unstated for rerun', ctx);
    }
    probed += 1;
    if (probed % 200 === 0) {
      log('info', 'progress', { probed, valid, invalid, remaining: queue.length - probed, failed });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length) }, worker));

log('info', 'slug probe finished', { ats: args.ats, probed, valid, invalid, failed });
writeOut();
