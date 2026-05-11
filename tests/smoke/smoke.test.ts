/**
 * Smoke tests — verifies the post-build artifact harness itself works.
 *
 * Runs `scripts/verify-bundle.mjs` and `scripts/smoke-test.mjs` as child
 * processes and asserts exit code 0. The optional Apps Script ping branch is
 * skipped here on purpose: smoke-test.mjs is designed to no-op cleanly when
 * APPS_SCRIPT_URL is unset, and CI usually has no deployed URL.
 *
 * These tests build the bundles end-to-end, so they take longer than typical
 * unit tests (~5–15 s on a warm box). The timeout below accounts for that.
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const VERIFY_BUNDLE = join(ROOT, 'scripts', 'verify-bundle.mjs');
const SMOKE_TEST = join(ROOT, 'scripts', 'smoke-test.mjs');

// 90 s is generous; on a warm box the full pipeline runs in ~5 s but a cold
// esbuild start can hit ~20 s on CI.
const TIMEOUT_MS = 90_000;

/** Run a Node script with APPS_SCRIPT_URL stripped from the env. */
function runScript(scriptPath: string) {
  // Build a clean env that omits APPS_SCRIPT_URL — this guarantees the smoke
  // test's optional-ping branch takes the "skip" path regardless of how the
  // tests are invoked.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.APPS_SCRIPT_URL;

  return spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: TIMEOUT_MS,
  });
}

describe('smoke harness', () => {
  it(
    'verify-bundle.mjs exits 0',
    () => {
      const res = runScript(VERIFY_BUNDLE);
      if (res.status !== 0) {
        // Surface the script output when failing so CI logs are actionable.
        // eslint-disable-next-line no-console
        console.error('verify-bundle stdout:\n' + res.stdout);
        // eslint-disable-next-line no-console
        console.error('verify-bundle stderr:\n' + res.stderr);
      }
      expect(res.status).toBe(0);
      // Sanity check: report should mention both bundles.
      expect(res.stdout).toContain('extension:');
      expect(res.stdout).toContain('appsscript:');
    },
    TIMEOUT_MS,
  );

  it(
    'smoke-test.mjs exits 0 with APPS_SCRIPT_URL unset (ping skipped)',
    () => {
      const res = runScript(SMOKE_TEST);
      if (res.status !== 0) {
        // eslint-disable-next-line no-console
        console.error('smoke-test stdout:\n' + res.stdout);
        // eslint-disable-next-line no-console
        console.error('smoke-test stderr:\n' + res.stderr);
      }
      expect(res.status).toBe(0);
      // Confirm the optional ping was explicitly skipped, not silently run.
      expect(res.stdout).toMatch(/SKIP/);
      expect(res.stdout).toMatch(/APPS_SCRIPT_URL not set/);
      expect(res.stdout).toContain('smoke checks passed');
    },
    TIMEOUT_MS,
  );
});
