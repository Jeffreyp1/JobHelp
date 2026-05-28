#!/usr/bin/env node
// POST a JSON request to the deployed Apps Script /exec URL and pretty-print the response.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ACTIONS: string[] = [
  'ping',
  'generate',
  'finalize',
  'list_files',
  'write_file',
  'seed_defaults',
  'download_template',
  'upload_filled_docx',
  'create_drive_file',
  'research_company',
  'benchmark_role',
  'critique',
  'auto_revise',
  'auto_revise_scoped',
  'cover_letter',
  'verify_cl_hooks',
  'multi_version',
  'extract_profile',
  'discover_and_rank',
  'update_job_status',
];

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

const USE_COLOR: boolean = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string): string => (USE_COLOR ? `${code}${s}${ANSI.reset}` : s);

function printHelp(): void {
  const lines = [
    `${c(ANSI.bold, 'test-handler.mts')} — POST a JSON request to the deployed Apps Script /exec URL.`,
    '',
    `${c(ANSI.bold, 'USAGE')}`,
    '  node scripts/test-handler.mts <action> [--field=value ...]',
    `  echo '<json>' | node scripts/test-handler.mts <action>`,
    '  node scripts/test-handler.mts <action> < request.json',
    '',
    `${c(ANSI.bold, 'ENVIRONMENT')}`,
    '  APPS_SCRIPT_URL   Full /exec URL of the deployed Apps Script web app.',
    '                    Read from process.env or a `.env` file in repo root.',
    '',
    `${c(ANSI.bold, 'ACTIONS')}`,
    ...ACTIONS.map(a => `  ${c(ANSI.cyan, a)}`),
    '',
    `${c(ANSI.bold, 'FLAGS')}`,
    '  --help, -h        Show this message and exit.',
    '  --field=value     Set a top-level request field. Values are parsed as JSON',
    '                    when possible (numbers, booleans, JSON arrays/objects);',
    '                    otherwise treated as a string.',
    '',
    `${c(ANSI.bold, 'EXAMPLES')}`,
    `  ${c(ANSI.dim, '# Health check')}`,
    '  APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec \\',
    '    node scripts/test-handler.mts ping',
    '',
    `  ${c(ANSI.dim, '# List files in a Drive folder')}`,
    '  node scripts/test-handler.mts list_files \\',
    '    --folderId=1abc... --folderType=rules',
    '',
    `  ${c(ANSI.dim, '# Pipe a full JSON body')}`,
    `  echo '{"action":"ping"}' | node scripts/test-handler.mts ping`,
    '',
    `  ${c(ANSI.dim, '# Read from a JSON file')}`,
    '  node scripts/test-handler.mts generate < req.json',
    '',
  ];
  console.log(lines.join('\n'));
}

async function loadEnvFile(): Promise<Record<string, string>> {
  const envPath = join(ROOT, '.env');
  let text: string;
  try {
    text = await readFile(envPath, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

type FieldValue = string | number | boolean | null | unknown[] | Record<string, unknown>;

function parseFlags(argv: string[]): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      fields[body] = true;
      continue;
    }
    const key = body.slice(0, eq);
    const raw = body.slice(eq + 1);
    fields[key] = coerceValue(raw);
  }
  return fields;
}

function coerceValue(raw: string): FieldValue {
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (
    (raw.startsWith('[') && raw.endsWith(']')) ||
    (raw.startsWith('{') && raw.endsWith('}'))
  ) {
    try {
      return JSON.parse(raw) as FieldValue;
    } catch {
      // fall through to string
    }
  }
  return raw;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function colourJson(json: string): string {
  if (!USE_COLOR) return json;
  return json.replace(
    /("(\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+\-]?\d+)?/g,
    (match: string, str: string | undefined, _esc: string | undefined, colon: string | undefined, kw: string | undefined): string => {
      if (str !== undefined) {
        return colon
          ? `${c(ANSI.cyan, str)}${colon}`
          : c(ANSI.green, str);
      }
      if (kw === 'true' || kw === 'false') return c(ANSI.yellow, match);
      if (kw === 'null') return c(ANSI.dim, match);
      return c(ANSI.magenta, match);
    },
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

interface ApiResponseBody {
  ok?: boolean;
  error?: { type?: string };
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const argv: string[] = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const action = argv[0];
  if (action.startsWith('--')) {
    console.error(c(ANSI.red, `Error: first argument must be an action, got "${action}".`));
    console.error(`Run with --help to see usage.`);
    process.exit(1);
  }
  if (!ACTIONS.includes(action)) {
    console.error(c(ANSI.red, `Error: unknown action "${action}".`));
    console.error(`Valid actions: ${ACTIONS.join(', ')}`);
    process.exit(1);
  }

  const envFile = await loadEnvFile();
  const url: string | undefined = process.env.APPS_SCRIPT_URL || envFile.APPS_SCRIPT_URL;
  if (!url) {
    console.error(c(ANSI.red, 'Error: APPS_SCRIPT_URL is not set.'));
    console.error('');
    console.error('Set it via environment:');
    console.error('  export APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec');
    console.error('');
    console.error('Or add to .env in repo root:');
    console.error('  APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec');
    process.exit(1);
  }

  // stdin JSON < --flag fields < action from argv[0] (last wins).
  const flagFields = parseFlags(argv.slice(1));
  const stdinText = await readStdin();

  let body: Record<string, unknown>;
  if (stdinText) {
    try {
      const parsed: unknown = JSON.parse(stdinText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.error(c(ANSI.red, 'Error: stdin JSON must be an object.'));
        process.exit(1);
      }
      body = { ...(parsed as Record<string, unknown>), ...flagFields, action };
    } catch (err) {
      console.error(c(ANSI.red, `Error: stdin is not valid JSON — ${(err as Error).message}`));
      process.exit(1);
    }
  } else {
    body = { ...flagFields, action };
  }

  const payload = JSON.stringify(body);
  const requestBytes = Buffer.byteLength(payload, 'utf8');

  console.log(c(ANSI.bold, `→ POST ${url}`));
  console.log(`  ${c(ANSI.dim, 'action:')} ${c(ANSI.cyan, action)}`);
  console.log(`  ${c(ANSI.dim, 'request:')} ${formatBytes(requestBytes)}`);
  console.log('');

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      redirect: 'follow',
    });
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error(c(ANSI.red, `✗ Network error after ${formatMs(elapsed)}: ${(err as Error).message}`));
    process.exit(1);
  }
  const elapsed = Date.now() - started;

  const responseText = await response.text();
  const responseBytes = Buffer.byteLength(responseText, 'utf8');

  console.log(c(ANSI.bold, `← ${response.status} ${response.statusText}`));
  console.log(`  ${c(ANSI.dim, 'response:')} ${formatBytes(responseBytes)}`);
  console.log(`  ${c(ANSI.dim, 'time:')}     ${formatMs(elapsed)}`);
  console.log('');

  let parsed: ApiResponseBody;
  try {
    parsed = JSON.parse(responseText) as ApiResponseBody;
  } catch {
    console.log(c(ANSI.yellow, '⚠ Response is not valid JSON:'));
    console.log(responseText);
    process.exit(1);
  }

  const pretty = JSON.stringify(parsed, null, 2);
  console.log(colourJson(pretty));
  console.log('');

  if (parsed && parsed.ok === true) {
    console.log(c(ANSI.green, '✓ ok=true'));
    process.exit(0);
  } else if (parsed && parsed.ok === false) {
    const errType = parsed.error?.type ? ` (${parsed.error.type})` : '';
    console.log(c(ANSI.red, `✗ ok=false${errType}`));
    process.exit(1);
  } else {
    console.log(c(ANSI.yellow, '⚠ response has no `ok` field'));
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(c(ANSI.red, `Fatal: ${e.stack || e.message || String(err)}`));
  process.exit(1);
});
