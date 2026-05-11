#!/usr/bin/env node
/**
 * test-handler.mjs — POST a JSON request to the deployed Apps Script /exec URL
 * and pretty-print the response.
 *
 * Usage:
 *   node scripts/test-handler.mjs <action> [--field=value ...]
 *   echo '<json>' | node scripts/test-handler.mjs <action>
 *   node scripts/test-handler.mjs <action> < request.json
 *
 * Reads APPS_SCRIPT_URL from process.env or .env (manual parse, no dotenv dep).
 * Exit code: 0 if ok=true, 1 otherwise.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ACTIONS = [
  'ping',
  'generate',
  'finalize',
  'list_files',
  'write_file',
  'seed_defaults',
  'download_template',
  'upload_filled_docx',
  'research_company',
  'benchmark_role',
  'critique',
  'auto_revise',
  'cover_letter',
  'verify_cl_hooks',
  'multi_version',
];

// Minimal ANSI codes — no chalk dep.
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
};

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (USE_COLOR ? `${code}${s}${ANSI.reset}` : s);

// ─────────────────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────────────────

function printHelp() {
  const lines = [
    `${c(ANSI.bold, 'test-handler.mjs')} — POST a JSON request to the deployed Apps Script /exec URL.`,
    '',
    `${c(ANSI.bold, 'USAGE')}`,
    '  node scripts/test-handler.mjs <action> [--field=value ...]',
    `  echo '<json>' | node scripts/test-handler.mjs <action>`,
    '  node scripts/test-handler.mjs <action> < request.json',
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
    '    node scripts/test-handler.mjs ping',
    '',
    `  ${c(ANSI.dim, '# List files in a Drive folder')}`,
    '  node scripts/test-handler.mjs list_files \\',
    '    --folderId=1abc... --folderType=rules',
    '',
    `  ${c(ANSI.dim, '# Pipe a full JSON body')}`,
    `  echo '{"action":"ping"}' | node scripts/test-handler.mjs ping`,
    '',
    `  ${c(ANSI.dim, '# Read from a JSON file')}`,
    '  node scripts/test-handler.mjs generate < req.json',
    '',
  ];
  console.log(lines.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// .env parsing (manual — no dotenv dep)
// ─────────────────────────────────────────────────────────────────────────────

async function loadEnvFile() {
  const envPath = join(ROOT, '.env');
  let text;
  try {
    text = await readFile(envPath, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
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

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse `--key=value` flags into an object. Values are decoded as JSON when
 * they look like JSON (numbers, booleans, null, arrays, objects); otherwise
 * they remain plain strings.
 */
function parseFlags(argv) {
  const fields = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      // Bare flag: treat as boolean true.
      fields[body] = true;
      continue;
    }
    const key = body.slice(0, eq);
    const raw = body.slice(eq + 1);
    fields[key] = coerceValue(raw);
  }
  return fields;
}

function coerceValue(raw) {
  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  // Booleans / null
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  // JSON arrays / objects
  if (
    (raw.startsWith('[') && raw.endsWith(']')) ||
    (raw.startsWith('{') && raw.endsWith('}'))
  ) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to string
    }
  }
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// stdin reader
// ─────────────────────────────────────────────────────────────────────────────

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pretty JSON colourisation (lightweight — no jq dep)
// ─────────────────────────────────────────────────────────────────────────────

function colourJson(json) {
  if (!USE_COLOR) return json;
  // Strings (incl. keys), numbers, booleans, null.
  return json.replace(
    /("(\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+\-]?\d+)?/g,
    (match, str, _esc, colon, kw) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

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

  // Resolve APPS_SCRIPT_URL: env var wins, .env file is fallback.
  const envFile = await loadEnvFile();
  const url = process.env.APPS_SCRIPT_URL || envFile.APPS_SCRIPT_URL;
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

  // Build the request body. Precedence: stdin JSON > --flag fields. The action
  // from argv[0] always wins (so users can't accidentally mismatch action and body).
  const flagFields = parseFlags(argv.slice(1));
  const stdinText = await readStdin();

  let body;
  if (stdinText) {
    try {
      const parsed = JSON.parse(stdinText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.error(c(ANSI.red, 'Error: stdin JSON must be an object.'));
        process.exit(1);
      }
      body = { ...parsed, ...flagFields, action };
    } catch (err) {
      console.error(c(ANSI.red, `Error: stdin is not valid JSON — ${err.message}`));
      process.exit(1);
    }
  } else {
    body = { ...flagFields, action };
  }

  const payload = JSON.stringify(body);
  const requestBytes = Buffer.byteLength(payload, 'utf8');

  // Header
  console.log(c(ANSI.bold, `→ POST ${url}`));
  console.log(`  ${c(ANSI.dim, 'action:')} ${c(ANSI.cyan, action)}`);
  console.log(`  ${c(ANSI.dim, 'request:')} ${formatBytes(requestBytes)}`);
  console.log('');

  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      // Apps Script accepts JSON bodies under text/plain too; either content-type works.
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      redirect: 'follow',
    });
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error(c(ANSI.red, `✗ Network error after ${formatMs(elapsed)}: ${err.message}`));
    process.exit(1);
  }
  const elapsed = Date.now() - started;

  const responseText = await response.text();
  const responseBytes = Buffer.byteLength(responseText, 'utf8');

  console.log(c(ANSI.bold, `← ${response.status} ${response.statusText}`));
  console.log(`  ${c(ANSI.dim, 'response:')} ${formatBytes(responseBytes)}`);
  console.log(`  ${c(ANSI.dim, 'time:')}     ${formatMs(elapsed)}`);
  console.log('');

  // Parse and pretty-print.
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Not JSON — print raw and exit non-zero.
    console.log(c(ANSI.yellow, '⚠ Response is not valid JSON:'));
    console.log(responseText);
    process.exit(1);
  }

  const pretty = JSON.stringify(parsed, null, 2);
  console.log(colourJson(pretty));
  console.log('');

  // Status line + exit code.
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

main().catch(err => {
  console.error(c(ANSI.red, `Fatal: ${err.stack || err.message || err}`));
  process.exit(1);
});
