import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { pickAts, ADAPTERS_BY_NAME } from './ats/registry.ts';

const HELP = `apply-leftovers-cli — apply AI-drafted answers to a prefilled daemon tab

  --tab-url <url>     URL of the already-open tab (prefix match)
  --answers <path>    JSON file: { "<fieldKey>": "<answer>", ... }
  --ats <name>        Force adapter (else picked from --tab-url)
  --cdp <endpoint>    Default http://localhost:9222

Applies answers via the engine's applyFreeform, re-validates, prints a JSON
report to stdout. Never clicks submit.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'tab-url': { type: 'string' },
      answers: { type: 'string' },
      ats: { type: 'string' },
      cdp: { type: 'string', default: 'http://localhost:9222' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help === true || values['tab-url'] === undefined || values.answers === undefined) {
    console.log(HELP);
    return values.help === true ? 0 : 1;
  }
  const tabUrl = values['tab-url'];
  const parsed: unknown = JSON.parse(await readFile(values.answers, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('answers file must be a JSON object');
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') answers[k] = v;
  }

  const ats = values.ats !== undefined ? ADAPTERS_BY_NAME.get(values.ats) : pickAts(tabUrl);
  if (!ats) throw new Error(`no adapter for ${values.ats ?? tabUrl}`);

  const browser = await chromium.connectOverCDP(values.cdp ?? 'http://localhost:9222');
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('daemon has no default context');
    const page = ctx.pages().find((p) => p.url().startsWith(tabUrl));
    if (!page) throw new Error(`no open tab matching ${tabUrl}`);
    const applied = await ats.applyFreeform(page, answers);
    const validation = await ats.validate(page);
    console.log(
      JSON.stringify(
        {
          applied,
          notApplied: Object.keys(answers).filter((k) => !applied.includes(k)),
          blockers: validation.blockers,
          captcha: validation.captcha,
          title: await page.title(),
          url: page.url(),
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
