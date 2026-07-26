#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { port: { type: 'string' } },
});

const port = Number.parseInt(String(values.port ?? process.env['JOBHELP_CDP_PORT'] ?? '9222'), 10);
const versionUrl = `http://localhost:${port}/json/version`;

async function alreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(versionUrl);
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (await alreadyRunning()) {
    console.log(`cdp already serving on ${port}`);
    process.exit(0);
  }

  const browser = await chromium.launch({
    headless: false,
    args: [`--remote-debugging-port=${port}`],
  });

  const ctx = await browser.newContext();
  await ctx.newPage().then((p) => p.goto('about:blank'));

  console.log(`cdp ready on http://localhost:${port}`);

  const shutdown = async (): Promise<void> => {
    await browser.close().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  await new Promise<never>(() => undefined);
}

main().catch((e: unknown) => {
  console.error('browser-daemon fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
