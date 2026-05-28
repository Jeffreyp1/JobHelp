#!/usr/bin/env node
// Post-build state verifier: runs both build pipelines and asserts artifact shape.

import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXTENSION_ROOT = join(ROOT, 'extension-app', 'extension');
const APPSSCRIPT_ROOT = join(ROOT, 'extension-app', 'appsscript');
const MCP_ROOT = join(ROOT, 'jobhelp-mcp');
const EXTENSION_PUBLIC = join(EXTENSION_ROOT, 'public');
const APPSSCRIPT_DIST = join(APPSSCRIPT_ROOT, 'dist');

const PATHS = {
  sidepanelJs: join(EXTENSION_PUBLIC, 'sidepanel', 'index.js'),
  background: join(EXTENSION_PUBLIC, 'background.js'),
  scraper: join(EXTENSION_PUBLIC, 'scraper.bundle.js'),
  manifest: join(EXTENSION_PUBLIC, 'manifest.json'),
  sidepanelCss: join(EXTENSION_PUBLIC, 'sidepanel', 'style.css'),
  codeGs: join(APPSSCRIPT_DIST, 'Code.gs'),
  changelog: join(ROOT, 'CHANGELOG.md'),
} as const;

const SIZE_LIMITS = {
  sidepanelJs: 2 * 1024 * 1024,
  background: 500 * 1024,
  codeGs: 200 * 1024,
} as const;

// Must mirror extension-app/appsscript/src/Code.ts VALID_ACTIONS.
const VALID_ACTIONS: string[] = [
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
  'ping',
];

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

interface CheckResult {
  name: string;
  ok: boolean;
  msg: string;
  durationMs: number;
  detail?: string;
}

const results: CheckResult[] = [];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

interface FailureError extends Error {
  detail?: string;
}

async function check(name: string, fn: () => string | undefined | Promise<string | undefined>): Promise<void> {
  const started = Date.now();
  try {
    const msg = await fn();
    const durationMs = Date.now() - started;
    results.push({ name, ok: true, msg: msg || 'ok', durationMs });
  } catch (err) {
    const durationMs = Date.now() - started;
    const e = err as FailureError;
    const message = e && e.message ? e.message : String(err);
    const detail = e && e.detail ? String(e.detail) : undefined;
    results.push({ name, ok: false, msg: message, durationMs, detail });
  }
}

function fail(message: string, detail?: string): never {
  const e: FailureError = new Error(message);
  if (detail) e.detail = detail;
  throw e;
}

function runBuild(label: string, scriptPath: string): { durationMs: number } {
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

function runCommand(label: string, command: string, args: string[]): { durationMs: number } {
  const started = Date.now();
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const durationMs = Date.now() - started;
  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || '').split('\n').slice(-20).join('\n');
    fail(`${label} failed with exit ${res.status} (${formatMs(durationMs)})`, tail);
  }
  return { durationMs };
}

async function assertFileSize(path: string, { maxBytes, minBytes = 1 }: { maxBytes?: number; minBytes?: number }): Promise<number> {
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

function assertCodeGsStartsValid(text: string): void {
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) fail('Code.gs starts with an unterminated block comment');
      i = end + 2;
      continue;
    }
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
  const head = text.slice(0, 2048);
  const tsLeftovers: { re: RegExp; label: string }[] = [
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

async function readLatestChangelogVersion(): Promise<string> {
  const text = await readFile(PATHS.changelog, 'utf8');
  const m = text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  if (!m) fail('CHANGELOG.md has no `## [x.y.z]` heading');
  return m[1];
}

interface Manifest {
  manifest_version: number;
  version: string;
}

async function main(): Promise<void> {
  const skipBuild = process.argv.includes('--no-build');

  console.log(c(ANSI.bold, '→ verify-bundle.mts'));
  console.log(`  ${c(ANSI.dim, 'root:')} ${ROOT}`);
  console.log('');

  if (!skipBuild) {
    await check('build: extension', () => {
      const { durationMs } = runBuild('extension', join(EXTENSION_ROOT, 'scripts', 'build.mts'));
      return `built in ${formatMs(durationMs)}`;
    });
    await check('build: appsscript', () => {
      const { durationMs } = runBuild(
        'appsscript',
        join(APPSSCRIPT_ROOT, 'scripts', 'build.mts'),
      );
      return `built in ${formatMs(durationMs)}`;
    });
  } else {
    console.log(c(ANSI.yellow, '  (--no-build: skipping build pipelines)'));
    console.log('');
  }

  await check('jobhelp-mcp: MCP regression tests', () => {
    const { durationMs } = runCommand('jobhelp-mcp MCP tests', 'npm', [
      '--prefix',
      MCP_ROOT,
      'test',
      '--',
      '--run',
      'tests/mcp',
    ]);
    return `passed in ${formatMs(durationMs)}`;
  });

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
    let manifest: Manifest;
    try {
      manifest = JSON.parse(raw) as Manifest;
    } catch (err) {
      fail(`manifest.json is not valid JSON: ${(err as Error).message}`);
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
    const manifest = JSON.parse(raw) as Manifest;
    const changelogVersion = await readLatestChangelogVersion();
    if (manifest.version !== changelogVersion) {
      fail(
        `manifest.version=${manifest.version} but CHANGELOG latest is ${changelogVersion}`,
        'A release was added to CHANGELOG but extension-app/extension/public/manifest.json was not bumped (or vice versa).',
      );
    }
    return `both at ${manifest.version}`;
  });

  await check('appsscript: Code.gs size', async () => {
    const size = await assertFileSize(PATHS.codeGs, { maxBytes: SIZE_LIMITS.codeGs });
    return `${formatBytes(size)} (limit ${formatBytes(SIZE_LIMITS.codeGs)})`;
  });

  let codeGsText: string | null = null;
  await check('appsscript: Code.gs starts with valid JS', async () => {
    codeGsText = await readFile(PATHS.codeGs, 'utf8');
    assertCodeGsStartsValid(codeGsText);
    return 'valid prelude, no TS leftovers';
  });

  await check('appsscript: Code.gs contains doPost', async () => {
    if (codeGsText == null) codeGsText = await readFile(PATHS.codeGs, 'utf8');
    if (!/\bfunction\s+doPost\b/.test(codeGsText)) {
      fail('Code.gs missing `function doPost` declaration');
    }
    return 'doPost entry present';
  });

  await check('appsscript: Code.gs contains all VALID_ACTIONS', async () => {
    if (codeGsText == null) codeGsText = await readFile(PATHS.codeGs, 'utf8');
    const missing: string[] = [];
    for (const action of VALID_ACTIONS) {
      const re = new RegExp(`["']${action}["']`);
      if (!re.test(codeGsText)) missing.push(action);
    }
    if (missing.length > 0) {
      fail(`missing actions in Code.gs: ${missing.join(', ')}`);
    }
    return `all ${VALID_ACTIONS.length} actions present`;
  });

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

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(c(ANSI.red, `Fatal: ${e.stack || e.message || String(err)}`));
  process.exit(1);
});
