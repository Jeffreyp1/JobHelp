#!/usr/bin/env node
// Pre-commit / CI smoke harness: verify-bundle.mts + optional Apps Script ping.

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const VERIFY_BUNDLE = join(__dirname, 'verify-bundle.mts');
const TEST_HANDLER = join(__dirname, 'test-handler.mts');

const USE_COLOR: boolean = process.stdout.isTTY && !process.env.NO_COLOR;
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
} as const;
const c = (code: string, s: string): string => (USE_COLOR ? `${code}${s}${ANSI.reset}` : s);

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

async function readAppsScriptUrl(): Promise<string | null> {
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
    // no .env is fine
  }
  return null;
}

function runVerifyBundle(): number {
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

interface PingResult {
  durationMs: number;
  skipped: boolean;
}

interface PingBody {
  ok?: boolean;
  version?: unknown;
  serverTime?: unknown;
}

async function runOptionalPing(): Promise<PingResult> {
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
  const res = spawnSync(process.execPath, [TEST_HANDLER, 'ping'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, APPS_SCRIPT_URL: url, NO_COLOR: '1' },
  });
  const durationMs = Date.now() - started;

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    console.error(c(ANSI.red, `✗ ping failed with exit ${res.status} (${formatMs(durationMs)})`));
    process.exit(1);
  }

  const stdout = res.stdout || '';
  const match = stdout.match(/\{[\s\S]*\}/);
  let body: PingBody | null = null;
  if (match) {
    try {
      body = JSON.parse(match[0]) as PingBody;
    } catch {
      // soft fall-through to missing-field warning
    }
  }

  const missing: string[] = [];
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
      c(ANSI.dim, ` — version=${body!.version}, serverTime=${body!.serverTime}`),
  );
  console.log(c(ANSI.dim, `  phase 2 elapsed: ${formatMs(durationMs)}`));
  console.log('');
  return { durationMs, skipped: false };
}

async function main(): Promise<void> {
  console.log(c(ANSI.bold, '→ smoke-test.mts'));
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

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(c(ANSI.red, `Fatal: ${e.stack || e.message || String(err)}`));
  process.exit(1);
});
