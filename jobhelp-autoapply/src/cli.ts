#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stateFilePath, statusSidecarPath, profilePath } from './paths.ts';
import { loadProfile } from './profile.ts';
import { selectReadyJobs } from './queue.ts';
import { launchBrowser, newTab } from './browser.ts';
import { pickAts } from './ats/registry.ts';
import { applyOneJob, type ApplyDeps } from './apply.ts';
import { runPool } from './pool.ts';
import { renderJakestyleConverter } from './convert.ts';
import { formatRunSummary, type RunRow } from './review.ts';
import { log } from './log.ts';

interface CliOptions {
  batch: number;
  concurrency: number;
  autoSubmit: boolean;
  dryRun: boolean;
  job?: string;
  headful: boolean;
  freeformWaitMs: number;
}

function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      batch: { type: 'string', default: '8' },
      concurrency: { type: 'string', default: '1' },
      'auto-submit': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      job: { type: 'string' },
      headless: { type: 'boolean', default: false },
      'freeform-timeout': { type: 'string', default: '0' },
    },
  });
  const batch = Number.parseInt(String(values.batch), 10);
  const concurrency = Number.parseInt(String(values.concurrency), 10);
  return {
    batch: Number.isFinite(batch) && batch > 0 ? batch : 8,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
    autoSubmit: values['auto-submit'] === true,
    dryRun: values['dry-run'] === true,
    ...(values.job !== undefined ? { job: String(values.job) } : {}),
    headful: values.headless !== true,
    freeformWaitMs: Math.max(0, Number.parseInt(String(values['freeform-timeout']), 10) || 0) * 1000,
  };
}

async function main(): Promise<number> {
  const opts = parseCli(process.argv.slice(2));

  let profile;
  try {
    profile = await loadProfile(profilePath());
  } catch (e: unknown) {
    log('error', 'profile load failed', { error: e instanceof Error ? e.message : String(e) });
    console.error(`\nCreate ${profilePath()} with your standing answers (firstName, email, etc.).`);
    return 1;
  }

  const jobs = await selectReadyJobs({
    stateFile: stateFilePath(),
    sidecar: statusSidecarPath(),
    limit: opts.batch,
    ...(opts.job !== undefined ? { onlyJobId: opts.job } : {}),
  });
  if (jobs.length === 0) {
    console.log('Nothing ready to apply to (need a supported ATS url + a tailored resume).');
    return 0;
  }

  const browser = await launchBrowser(opts.headful);
  const rows: RunRow[] = [];
  const runStart = Date.now();
  try {
    await runPool(jobs, opts.concurrency, async (job) => {
      const ats = pickAts(job.url);
      if (!ats) {
        log('warn', 'no adapter for url; skipping', { jobId: job.jobId, url: job.url });
        return;
      }
      const deps: ApplyDeps = {
        ats,
        converter: renderJakestyleConverter,
        sidecarPath: statusSidecarPath(),
        autoSubmit: opts.autoSubmit,
        dryRun: opts.dryRun,
        freeformWaitMs: opts.freeformWaitMs,
        now: () => new Date().toISOString(),
      };
      const page = await newTab(browser);
      const jobStart = Date.now();
      try {
        rows.push(await applyOneJob(page, job, profile, deps));
      } catch (e: unknown) {
        log('error', 'job failed', { jobId: job.jobId, error: e instanceof Error ? e.message : String(e) });
      }
      console.log(`[timing] ${job.jobId} ${((Date.now() - jobStart) / 1000).toFixed(1)}s`);
    });
  } finally {
    const totalS = (Date.now() - runStart) / 1000;
    const n = Math.max(rows.length, 1);
    const mode = opts.concurrency > 1 ? `parallel x${opts.concurrency}` : 'sequential';
    console.log(`\n${formatRunSummary(rows)}\n`);
    console.log(`[timing] total ${totalS.toFixed(1)}s, ${rows.length} jobs, avg ${(totalS / n).toFixed(1)}s/job (${mode})`);
  }

  const allSubmitted = rows.length > 0 && rows.every((r) => r.status === 'submitted');
  if (opts.dryRun || !opts.headful || allSubmitted) {
    await browser.close();
    return 0;
  }
  console.log('Browser left open for review. Press Ctrl-C here when you have submitted them.');
  await new Promise<never>(() => undefined);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    log('error', 'fatal', { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
