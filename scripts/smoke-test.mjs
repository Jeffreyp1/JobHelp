#!/usr/bin/env node
/**
 * smoke-test.mjs — pre-commit / CI smoke harness.
 *
 * 1. Runs verify-bundle.mjs (builds + asserts artifact shape).
 * 2. If APPS_SCRIPT_URL is set: pings the deployed Apps Script and asserts
 *    `{ ok: true, version, serverTime }`. Otherwise skips with a clear message.
 *
 * Exits 0 if all selected checks pass, 1 otherwise. Wallclock time per phase
 * is printed for easy CI debugging.
 *
 * Node 18+ built-ins only — no dependencies.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *   APPS_SCRIPT_URL=https://script.google.com/... node scripts/smoke-test.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const VERIFY_BUNDLE = join(__dirname, 'verify-bundle.mjs');
const TEST_HANDLER = join(__dirname, 'test-handler.mjs');

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

function formatMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional .env loader (matches test-handler.mjs's contract — env var wins)
// ─────────────────────────────────────────────────────────────────────────────

async function readAppsScriptUrl() {
  if (process.env.APPS_SCRIPT_URL) return process.env.APPS_SCRIPT_URL;
  try {
    const text = await readFile(join(ROOT, '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key !== 'APPS_SCRIPT_URL') continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return val;
    }
  } catch {
    // No .env file is fine.
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — verify-bundle
// ─────────────────────────────────────────────────────────────────────────────

function runVerifyBundle() {
  console.log(c(ANSI.bold, '── phase 1: verify-bundle ─────────────────────────────'));
  const started = Date.now();
  const res = spawnSync(process.execPath, [VERIFY_BUNDLE], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  const durationMs = Date.now() - started;
  console.log(c(ANSI.dim, `  phase 1 elapsed: ${formatMs(durationMs)}`));
  console.log('');
  if (res.status !== 0) {
    console.error(c(ANSI.red, `✗ verify-bundle failed with exit ${res.status}`));
    process.exit(1);
  }
  return durationMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — optional Apps Script ping
// ─────────────────────────────────────────────────────────────────────────────

async function runOptionalPing() {
  console.log(c(ANSI.bold, '── phase 2: apps-script ping ──────────────────────────'));
  const url = await readAppsScriptUrl();
  if (!url) {
    console.log(
      c(ANSI.yellow, '  SKIP') +
        ' — APPS_SCRIPT_URL not set (env or .env).',
    );
    console.log(c(ANSI.dim, '         Set it to exercise the deployed web app.'));
    console.log('');
    return { durationMs: 0, skipped: true };
  }

  console.log(`  ${c(ANSI.dim, 'url:')} ${url}`);
  const started = Date.now();
  // Spawn test-handler.mjs in pipe mode so we can inspect its stdout for the
  // expected response shape. test-handler.mjs already prints a pretty JSON
  // body, asserts ok=true via exit code, and respects NO_COLOR.
  const res = spawnSync(process.execPath, [TEST_HANDLER, 'ping'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, APPS_SCRIPT_URL: url, NO_COLOR: '1' },
  });
  const durationMs = Date.now() - started;

  // Always echo the handler's output so CI logs are useful.
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    console.error(c(ANSI.red, `✗ ping failed with exit ${res.status} (${formatMs(durationMs)})`));
    process.exit(1);
  }

  // The response body is embedded in stdout; parse the first JSON object that
  // contains `"ok"` so we can assert it has the expected fields.
  const stdout = res.stdout || '';
  // Greedy match for outermost object — test-handler.mjs prints exactly one.
  const match = stdout.match(/\{[\s\S]*\}/);
  let body = null;
  if (match) {
    try {
      body = JSON.parse(match[0]);
    } catch {
      // Stray non-JSON between braces — fall through to soft warning.
    }
  }

  const missing = [];
  if (!body || body.ok !== true) missing.push('ok=true');
  if (!body || typeof body.version !== 'string') missing.push('version');
  if (!body || typeof body.serverTime !== 'string') missing.push('serverTime');

  if (missing.length > 0) {
    console.error(
      c(ANSI.red, `✗ ping response missing/invalid fields: ${missing.join(', ')}`),
    );
    process.exit(1);
  }

  console.log(
    c(ANSI.green, '  ✓ ping ok') +
      c(ANSI.dim, ` — version=${body.version}, serverTime=${body.serverTime}`),
  );
  console.log(c(ANSI.dim, `  phase 2 elapsed: ${formatMs(durationMs)}`));
  console.log('');
  return { durationMs, skipped: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(c(ANSI.bold, '→ smoke-test.mjs'));
  console.log(c(ANSI.dim, `  root: ${ROOT}`));
  console.log('');

  const wallStart = Date.now();
  const phase1Ms = runVerifyBundle();
  const phase2 = await runOptionalPing();
  const wallMs = Date.now() - wallStart;

  console.log(c(ANSI.bold, '── summary ────────────────────────────────────────────'));
  console.log(`  verify-bundle: ${formatMs(phase1Ms)}`);
  if (phase2.skipped) {
    console.log(`  ping:          ${c(ANSI.yellow, 'skipped')}`);
  } else {
    console.log(`  ping:          ${formatMs(phase2.durationMs)}`);
  }
  console.log(`  wallclock:     ${formatMs(wallMs)}`);
  console.log('');
  console.log(c(ANSI.green, '✓ smoke checks passed'));
  process.exit(0);
}

main().catch(err => {
  console.error(c(ANSI.red, `Fatal: ${err.stack || err.message || err}`));
  process.exit(1);
});
