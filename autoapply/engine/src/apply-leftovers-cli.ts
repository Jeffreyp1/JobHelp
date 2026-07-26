import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { connectBrowser } from './browser.ts';
import { stateFilePath, statusSidecarPath } from './paths.ts';
import { applyLeftoversToTab, runLeftoverWatch, type WatchJob } from './leftovers-watch.ts';

const HELP = `apply-leftovers-cli — apply AI-drafted answers to prefilled daemon tabs

SINGLE TAB
  --tab-url <url>     URL of the already-open tab (prefix match)
  --answers <path>    JSON file: { "<fieldKey>": "<answer>", ... }
  --dir <path>        Job dir: reads autoapply-leftovers.json so a fill-time
                      verified resume upload is not re-reported as a blocker
  --job <jobId>       Record status filled_parked for this job on completion
  --ats <name>        Force adapter (else picked from --tab-url)

WATCH MODE
  --watch <seconds>   Poll every 'prefilled' job for up to <seconds>; whenever a
                      job dir gains freeform-answers.json, apply it to that
                      job's open tab, re-validate, and record filled_parked.
                      One watcher covers a whole batch.

COMMON
  --cdp <endpoint>    Default http://localhost:9222

Applies answers via the engine's applyFreeform, re-validates, prints JSON
reports to stdout. Never clicks submit.`;

async function watchMain(cdp: string, seconds: number): Promise<number> {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--watch requires a positive number of seconds');
  const browser = await connectBrowser(cdp);
  try {
    const outcome = await runLeftoverWatch({
      browser,
      stateFile: stateFilePath(),
      sidecarPath: statusSidecarPath(),
      durationMs: seconds * 1000,
    });
    console.log(
      JSON.stringify(
        {
          applied: outcome.applied.map((j) => j.jobId),
          failed: outcome.failed.map((f) => ({ jobId: f.job.jobId, error: f.error })),
          pending: outcome.pending.map((j) => j.jobId),
        },
        null,
        2,
      ),
    );
    return outcome.failed.length > 0 ? 1 : 0;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'tab-url': { type: 'string' },
      answers: { type: 'string' },
      dir: { type: 'string' },
      job: { type: 'string' },
      ats: { type: 'string' },
      watch: { type: 'string' },
      cdp: { type: 'string', default: 'http://localhost:9222' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help === true) {
    console.log(HELP);
    return 0;
  }
  const cdp = values.cdp ?? 'http://localhost:9222';

  if (values.watch !== undefined) {
    return watchMain(cdp, Number.parseInt(values.watch, 10));
  }

  if (values['tab-url'] === undefined || values.answers === undefined) {
    console.log(HELP);
    return 1;
  }
  const parsed: unknown = JSON.parse(await readFile(values.answers, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('answers file must be a JSON object');
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') answers[k] = v;
  }

  const job: WatchJob = {
    jobId: values.job ?? '',
    company: '',
    role: '',
    url: values['tab-url'],
    dir: values.dir ?? '',
  };
  const browser = await connectBrowser(cdp);
  try {
    const result = await applyLeftoversToTab(browser, job, answers, {
      sidecarPath: statusSidecarPath(),
      now: () => new Date().toISOString(),
      ...(values.ats !== undefined ? { forceAts: values.ats } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
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
