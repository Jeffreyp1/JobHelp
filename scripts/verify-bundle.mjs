#!/usr/bin/env node
/**
 * verify-bundle.mjs — post-build state verifier.
 *
 * Runs both build pipelines (extension + Apps Script) and asserts the produced
 * artifacts are well-formed: present, non-empty, within size budgets, contain
 * the expected entry points and constants, and that manifest.json's version
 * matches the latest CHANGELOG entry.
 *
 * Exits 0 on all-pass, 1 on any failure. Designed to surface mis-shipped
 * builds quickly (e.g. version bump forgotten, TS leftover syntax, missing
 * VALID_ACTIONS entry).
 *
 * Node 18+ built-ins only — no dependencies.
 *
 * Usage:
 *   node scripts/verify-bundle.mjs
 *   node scripts/verify-bundle.mjs --no-build   (skip running build pipelines)
 */

import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXTENSION_PUBLIC = join(ROOT, 'extension', 'public');
const APPSSCRIPT_DIST = join(ROOT, 'appsscript', 'dist');

const PATHS = {
  sidepanelJs: join(EXTENSION_PUBLIC, 'sidepanel', 'index.js'),
  background: join(EXTENSION_PUBLIC, 'background.js'),
  scraper: join(EXTENSION_PUBLIC, 'scraper.bundle.js'),
  manifest: join(EXTENSION_PUBLIC, 'manifest.json'),
  sidepanelCss: join(EXTENSION_PUBLIC, 'sidepanel', 'style.css'),
  codeGs: join(APPSSCRIPT_DIST, 'Code.gs'),
  changelog: join(ROOT, 'CHANGELOG.md'),
};

const SIZE_LIMITS = {
  sidepanelJs: 2 * 1024 * 1024, // 2 MB
  background: 500 * 1024, // 500 KB
  codeGs: 200 * 1024, // 200 KB
};

// All 15 actions accepted by the Apps Script router. Keep in sync with
// appsscript/src/Code.ts VALID_ACTIONS — this verifier asserts every one
// appears in the compiled Code.gs string.
const VALID_ACTIONS = [
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
  'ping',
];

// ─────────────────────────────────────────────────────────────────────────────
// ANSI (NO_COLOR-aware)
// ─────────────────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const c = (code, s) => (USE_COLOR ? `${code}${s}${ANSI.reset}` : s);

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, ok: boolean, msg: string, durationMs: number, detail?: string }} CheckResult
 */

/** @type {CheckResult[]} */
const results = [];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Run a single named check. If `fn` throws, the check is recorded as failed
 * with the error message; otherwise the returned string (if any) becomes the
 * pass message.
 */
async function check(name, fn) {
  const started = Date.now();
  try {
    const msg = await fn();
    const durationMs = Date.now() - started;
    results.push({ name, ok: true, msg: msg || 'ok', durationMs });
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err && err.message ? err.message : String(err);
    const detail = err && err.detail ? String(err.detail) : undefined;
    results.push({ name, ok: false, msg: message, durationMs, detail });
  }
}

/** Throw a check failure with optional detail. */
function fail(message, detail) {
  const e = new Error(message);
  if (detail) e.detail = detail;
  throw e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build runners
// ─────────────────────────────────────────────────────────────────────────────

function runBuild(label, scriptPath) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const durationMs = Date.now() - started;
  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || '').split('\n').slice(-20).join('\n');
    fail(`${label} build failed with exit ${res.status} (${formatMs(durationMs)})`, tail);
  }
  return { durationMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// File-shape assertions
// ─────────────────────────────────────────────────────────────────────────────

async function assertFileSize(path, { maxBytes, minBytes = 1 }) {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    fail(`missing file: ${relative(ROOT, path)}`);
  }
  if (!stats.isFile()) fail(`not a file: ${relative(ROOT, path)}`);
  const size = stats.size;
  if (size < minBytes) {
    fail(`empty/too-small file: ${relative(ROOT, path)} (${formatBytes(size)})`);
  }
  if (maxBytes && size > maxBytes) {
    fail(
      `oversized file: ${relative(ROOT, path)} is ${formatBytes(size)}, limit ${formatBytes(maxBytes)}`,
    );
  }
  return size;
}

/**
 * Heuristic: does Code.gs start with code that the Apps Script V8 runtime
 * accepts? It must not contain TS-only constructs at the top (like an
 * `import type`, `interface`, or `: TypeName` after `function`). We allow a
 * leading block comment and then expect either `function`, `const`, `let`,
 * `var`, `class`, `async function`, `(`, `if`, `try`, or a Code.gs prelude
 * comment.
 */
function assertCodeGsStartsValid(text) {
  // Skip leading block/line comments + whitespace.
  let i = 0;
  while (i < text.length) {
    // Whitespace
    while (i < text.length && /\s/.test(text[i])) i++;
    // Block comment /* ... */
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) fail('Code.gs starts with an unterminated block comment');
      i = end + 2;
      continue;
    }
    // Line comment // ...
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      if (nl === -1) {
        i = text.length;
      } else {
        i = nl + 1;
      }
      continue;
    }
    break;
  }
  // What's the next token?
  const rest = text.slice(i, i + 200);
  const validStart =
    /^(function|class|const|let|var|async\s+function|if|try|\(function|"use strict")\b/.test(
      rest,
    );
  if (!validStart) {
    fail(
      'Code.gs first non-comment token is not valid Apps Script JS',
      `Got: ${rest.slice(0, 80).replace(/\n/g, '\\n')}`,
    );
  }
  // Catch obvious TS leftovers anywhere in first ~2 KB.
  const head = text.slice(0, 2048);
  const tsLeftovers = [
    { re: /^\s*import\s+type\b/m, label: 'import type' },
    { re: /^\s*export\s+(?!default\s|\*|\{)/m, label: 'top-level export keyword' },
    { re: /^\s*interface\s+\w/m, label: 'interface declaration' },
  ];
  for (const { re, label } of tsLeftovers) {
    if (re.test(head)) {
      fail(`Code.gs contains TypeScript leftover: ${label}`);
    }
  }
}

/** Get the most recent semver from CHANGELOG.md (e.g. "0.2.1"). */
async function readLatestChangelogVersion() {
  const text = await readFile(PATHS.changelog, 'utf8');
  const m = text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  if (!m) fail('CHANGELOG.md has no `## [x.y.z]` heading');
  return m[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const skipBuild = process.argv.includes('--no-build');

  console.log(c(ANSI.bold, '→ verify-bundle.mjs'));
  console.log(`  ${c(ANSI.dim, 'root:')} ${ROOT}`);
  console.log('');

  // ── Build step ────────────────────────────────────────────────────────────
  if (!skipBuild) {
    await check('build: extension', () => {
      const { durationMs } = runBuild('extension', join(ROOT, 'extension', 'scripts', 'build.mjs'));
      return `built in ${formatMs(durationMs)}`;
    });
    await check('build: appsscript', () => {
      const { durationMs } = runBuild(
        'appsscript',
        join(ROOT, 'appsscript', 'scripts', 'build.mjs'),
      );
      return `built in ${formatMs(durationMs)}`;
    });
  } else {
    console.log(c(ANSI.yellow, '  (--no-build: skipping build pipelines)'));
    console.log('');
  }

  // ── Extension artifact assertions ────────────────────────────────────────
  await check('extension: sidepanel/index.js', async () => {
    const size = await assertFileSize(PATHS.sidepanelJs, { maxBytes: SIZE_LIMITS.sidepanelJs });
    return `${formatBytes(size)} (limit ${formatBytes(SIZE_LIMITS.sidepanelJs)})`;
  });

  await check('extension: background.js', async () => {
    const size = await assertFileSize(PATHS.background, { maxBytes: SIZE_LIMITS.background });
    return `${formatBytes(size)} (limit ${formatBytes(SIZE_LIMITS.background)})`;
  });

  await check('extension: scraper.bundle.js', async () => {
    const size = await assertFileSize(PATHS.scraper, { maxBytes: undefined });
    return formatBytes(size);
  });

  await check('extension: sidepanel/style.css', async () => {
    const size = await assertFileSize(PATHS.sidepanelCss, { maxBytes: undefined });
    return formatBytes(size);
  });

  await check('extension: manifest.json shape', async () => {
    const raw = await readFile(PATHS.manifest, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      fail(`manifest.json is not valid JSON: ${err.message}`);
    }
    if (manifest.manifest_version !== 3) {
      fail(`manifest_version must be 3, got ${manifest.manifest_version}`);
    }
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      fail(`manifest.version must be semver "x.y.z", got ${JSON.stringify(manifest.version)}`);
    }
    return `mv3, version=${manifest.version}`;
  });

  await check('extension: manifest.version matches CHANGELOG latest', async () => {
    const raw = await readFile(PATHS.manifest, 'utf8');
    const manifest = JSON.parse(raw);
    const changelogVersion = await readLatestChangelogVersion();
    if (manifest.version !== changelogVersion) {
      fail(
        `manifest.version=${manifest.version} but CHANGELOG latest is ${changelogVersion}`,
        'A release was added to CHANGELOG but extension/public/manifest.json was not bumped (or vice versa).',
      );
    }
    return `both at ${manifest.version}`;
  });

  // ── Apps Script Code.gs assertions ───────────────────────────────────────
  await check('appsscript: Code.gs size', async () => {
    const size = await assertFileSize(PATHS.codeGs, { maxBytes: SIZE_LIMITS.codeGs });
    return `${formatBytes(size)} (limit ${formatBytes(SIZE_LIMITS.codeGs)})`;
  });

  let codeGsText = null;
  await check('appsscript: Code.gs starts with valid JS', async () => {
    codeGsText = await readFile(PATHS.codeGs, 'utf8');
    assertCodeGsStartsValid(codeGsText);
    return 'valid prelude, no TS leftovers';
  });

  await check('appsscript: Code.gs contains doPost', async () => {
    if (codeGsText == null) codeGsText = await readFile(PATHS.codeGs, 'utf8');
    // Must appear as a function/expression, not just inside a comment.
    if (!/\bfunction\s+doPost\b/.test(codeGsText)) {
      fail('Code.gs missing `function doPost` declaration');
    }
    return 'doPost entry present';
  });

  await check('appsscript: Code.gs contains all 15 VALID_ACTIONS', async () => {
    if (codeGsText == null) codeGsText = await readFile(PATHS.codeGs, 'utf8');
    const missing = [];
    for (const action of VALID_ACTIONS) {
      // Look for the action as a quoted string literal anywhere in the file.
      // Apps Script bundle uses double quotes after esbuild rewrites.
      const re = new RegExp(`["']${action}["']`);
      if (!re.test(codeGsText)) missing.push(action);
    }
    if (missing.length > 0) {
      fail(`missing actions in Code.gs: ${missing.join(', ')}`);
    }
    return `all ${VALID_ACTIONS.length} actions present`;
  });

  // ── Print report ─────────────────────────────────────────────────────────
  console.log('');
  const failed = results.filter(r => !r.ok);
  for (const r of results) {
    const icon = r.ok ? c(ANSI.green, 'PASS') : c(ANSI.red, 'FAIL');
    const time = c(ANSI.dim, `[${formatMs(r.durationMs)}]`);
    console.log(`  ${icon} ${r.name} ${time}`);
    console.log(`       ${c(ANSI.dim, r.msg)}`);
    if (!r.ok && r.detail) {
      for (const line of r.detail.split('\n')) {
        console.log(`         ${c(ANSI.dim, line)}`);
      }
    }
  }

  console.log('');
  const total = results.length;
  const passCount = total - failed.length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const summary = `${passCount}/${total} checks passed in ${formatMs(totalMs)}`;
  if (failed.length === 0) {
    console.log(c(ANSI.green, `✓ ${summary}`));
    process.exit(0);
  } else {
    console.log(c(ANSI.red, `✗ ${summary} (${failed.length} failed)`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(c(ANSI.red, `Fatal: ${err.stack || err.message || err}`));
  process.exit(1);
});
