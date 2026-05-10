/**
 * build.mjs
 *
 * esbuild config for the JobHelp Chrome extension.
 *
 * Outputs:
 *   public/background.js          — MV3 service worker
 *   public/scraper.bundle.js      — Self-contained scraper injected into pages
 *                                   Attaches window.__jobhelpScrape() entry point
 *   public/sidepanel/index.js     — Side panel UI bundle
 *
 * Usage:
 *   node extension/scripts/build.mjs
 *   node extension/scripts/build.mjs --watch
 */

import esbuild from 'esbuild';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');

const watch = process.argv.includes('--watch');

// ─────────────────────────────────────────────────────────────────────────────
// Ensure output directories exist
// ─────────────────────────────────────────────────────────────────────────────

mkdirSync(join(PUBLIC, 'sidepanel'), { recursive: true });
mkdirSync(join(PUBLIC, 'icons'), { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Copy static assets (HTML + CSS) into public/sidepanel/
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_ASSETS = [
  { from: join(SRC, 'sidepanel', 'index.html'), to: join(PUBLIC, 'sidepanel', 'index.html') },
  { from: join(SRC, 'sidepanel', 'style.css'),  to: join(PUBLIC, 'sidepanel', 'style.css')  },
];

for (const { from, to } of STATIC_ASSETS) {
  if (existsSync(from)) {
    copyFileSync(from, to);
    console.log(`  copied ${from} → ${to}`);
  } else {
    console.warn(`  WARNING: missing source ${from}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder icons (1×1 transparent PNG — replace with real icons before
// publishing to the Chrome Web Store)
// ─────────────────────────────────────────────────────────────────────────────

// Minimal 1×1 transparent PNG bytes
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

for (const size of [16, 48, 128]) {
  const iconPath = join(PUBLIC, 'icons', `icon-${size}.png`);
  if (!existsSync(iconPath)) {
    writeFileSync(iconPath, PLACEHOLDER_PNG);
    console.log(`  created placeholder ${iconPath}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scraper bundle entry shim
//
// The scraper module exports scrapePage(ctx) which requires a ScrapeContext
// argument.  When injected into a page we need a no-arg entry point that
// reads document + location.href from the page context automatically.
//
// We write the shim to a temp file and esbuild bundles it along with
// scraper.ts and its dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const scraperShimPath = join(ROOT, 'scripts', '_scraper-shim.ts');
const scraperShimCode = `
// Auto-generated entry shim for the scraper bundle.
// DO NOT import this file directly — it is only used by the build script.
import { scrapePage } from '../src/scraper.js';

declare global {
  interface Window {
    __jobhelpScrape: () => Promise<unknown>;
  }
}

window.__jobhelpScrape = () =>
  scrapePage({ document, url: location.href });
`;

writeFileSync(scraperShimPath, scraperShimCode);

// ─────────────────────────────────────────────────────────────────────────────
// Shared esbuild options
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  format: 'esm',
  target: ['chrome116'],
  platform: 'browser',
  treeShaking: true,
  minify: false, // Keep readable for debugging
  sourcemap: true,
  logLevel: 'info',
};

// ─────────────────────────────────────────────────────────────────────────────
// Build targets
// ─────────────────────────────────────────────────────────────────────────────

const builds = [
  {
    label: 'background',
    ...sharedOptions,
    entryPoints: [join(SRC, 'background.ts')],
    outfile: join(PUBLIC, 'background.js'),
  },
  {
    label: 'scraper.bundle',
    ...sharedOptions,
    entryPoints: [scraperShimPath],
    outfile: join(PUBLIC, 'scraper.bundle.js'),
    // The scraper runs in page context — important: must NOT import chrome APIs.
    define: {
      'process.env.NODE_ENV': '"production"',
      // Make the Node.js detection in skillsDict always false at bundle time
      // so the browser branch (fetch-based) is taken at runtime.
      'process.versions': 'undefined',
    },
    // Mark Node built-ins as external so esbuild doesn't try to bundle them.
    // The code guards these behind a `typeof process !== 'undefined'` check
    // that resolves to false in the browser, so these imports are dead code
    // after tree-shaking.
    external: ['fs', 'url', 'path'],
  },
  {
    label: 'sidepanel',
    ...sharedOptions,
    entryPoints: [join(SRC, 'sidepanel', 'index.ts')],
    outfile: join(PUBLIC, 'sidepanel', 'index.js'),
    // Side panel uses chrome APIs available in extension pages — no special treatment needed.
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Run / watch
// ─────────────────────────────────────────────────────────────────────────────

/** Strip the `label` field (used only for logging) before handing to esbuild. */
function esbuildOpts(opts) {
  const { label: _label, ...rest } = opts;
  return rest;
}

if (watch) {
  // Build all contexts in watch mode concurrently
  const contexts = await Promise.all(builds.map((opts) => esbuild.context(esbuildOpts(opts))));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching for changes…');
} else {
  // One-shot build
  const results = await Promise.allSettled(builds.map((opts) => esbuild.build(esbuildOpts(opts))));
  let hasError = false;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console.error(`Build failed [${builds[i].label}]:`, r.reason);
      hasError = true;
    }
  }
  if (hasError) process.exit(1);
  console.log('Build complete.');
}
