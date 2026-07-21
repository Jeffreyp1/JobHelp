import esbuild, { type BuildOptions, type Plugin } from 'esbuild';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');

const watch: boolean = process.argv.includes('--watch');

mkdirSync(join(PUBLIC, 'sidepanel'), { recursive: true });
mkdirSync(join(PUBLIC, 'icons'), { recursive: true });

interface StaticAsset {
  from: string;
  to: string;
}

const STATIC_ASSETS: StaticAsset[] = [
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

function sanitizeGeneratedJs(filePath: string): void {
  if (!filePath.endsWith('.js')) return;
  const source = readFileSync(filePath, 'utf8');
  const sanitized = source.replace(/[ \t]+$/gm, '');
  if (sanitized !== source) writeFileSync(filePath, sanitized);
}

const sanitizeGeneratedJsPlugin: Plugin = {
  name: 'sanitize-generated-js',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      const outfile = build.initialOptions.outfile;
      if (outfile) sanitizeGeneratedJs(outfile);
    });
  },
};

const sharedOptions: BuildOptions = {
  bundle: true,
  format: 'esm',
  target: ['chrome116'],
  platform: 'browser',
  treeShaking: true,
  minify: false,
  sourcemap: true,
  logLevel: 'info',
  plugins: [sanitizeGeneratedJsPlugin],
};

interface LabeledBuild extends BuildOptions {
  label: string;
}

const builds: LabeledBuild[] = [
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
    define: {
      'process.env.NODE_ENV': '"production"',
      // Force the Node detection in skillsDict to false so the browser branch is taken.
      'process.versions': 'undefined',
    },
    // Node built-ins are dead-code after tree-shaking when the typeof-process guard resolves to false.
    external: ['fs', 'url', 'path'],
  },
  {
    label: 'sidepanel',
    ...sharedOptions,
    entryPoints: [join(SRC, 'sidepanel', 'index.ts')],
    outfile: join(PUBLIC, 'sidepanel', 'index.js'),
  },
  {
    label: 'autofill.content',
    ...sharedOptions,
    // Manifest-declared content scripts run as classic scripts, not modules —
    // bundle to a self-contained IIFE so there are no runtime imports.
    format: 'iife',
    entryPoints: [join(SRC, 'autofill-content.ts')],
    outfile: join(PUBLIC, 'autofill.content.js'),
  },
];

function esbuildOpts(opts: LabeledBuild): BuildOptions {
  const { label: _label, ...rest } = opts;
  return rest;
}

if (watch) {
  const contexts = await Promise.all(builds.map((opts) => esbuild.context(esbuildOpts(opts))));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching for changes…');
} else {
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
