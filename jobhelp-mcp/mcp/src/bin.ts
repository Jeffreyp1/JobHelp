#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildServer, runStdio } from './index.js';
import { bootstrap } from './wiring.js';

const PACKAGE_NAME = '@jeffreyp1/jobhelp-mcp';
const SERVER_NAME = 'jobhelp-mcp';
const MAX_WALK_DEPTH = 8;

export interface PackageMeta {
  readonly name: string;
  readonly version: string;
}

export function loadPackageMeta(): PackageMeta {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = join(dir, 'package.json');
    let raw: string;
    try {
      raw = readFileSync(candidate, 'utf-8');
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (parsed.name === PACKAGE_NAME && typeof parsed.version === 'string') {
      return { name: SERVER_NAME, version: parsed.version };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`jobhelp-mcp: could not locate ${PACKAGE_NAME}/package.json`);
}

export async function main(): Promise<void> {
  const meta = loadPackageMeta();
  const { coreDeps, resourceDeps } = await bootstrap();
  const handle = buildServer({
    name: meta.name,
    version: meta.version,
    coreDeps,
    resourceDeps,
  });
  await runStdio(handle);
}

const entryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (entryPoint) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'unknown fatal error';
    process.stderr.write(`jobhelp-mcp: fatal: ${message}\n`);
    process.exit(1);
  });
}
