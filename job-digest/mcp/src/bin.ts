#!/usr/bin/env node
import { buildServer, runStdio } from './index.js';
import { bootstrap } from './wiring.js';

async function main(): Promise<void> {
  const { coreDeps, resourceDeps } = await bootstrap();
  const handle = buildServer({ coreDeps, resourceDeps });
  await runStdio(handle);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'unknown fatal error';
  process.stderr.write(`jobhelp-mcp: fatal: ${message}\n`);
  process.exit(1);
});
