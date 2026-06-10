#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stateFilePath, statusSidecarPath, profilePath } from './paths.ts';
import { loadProfile } from './profile.ts';
import { selectReadyJobs } from './queue.ts';
import { launchBrowser, connectBrowser, newTab } from './browser.ts';
import { pickAts } from './ats/registry.ts';
import { applyOneJob, type ApplyDeps } from './apply.ts';
import { runPool } from './pool.ts';
import { renderJakestyleConverter } from './convert.ts';
import { formatRunSummary, type RunRow } from './review.ts';
import { log } from './log.ts';
import type { ReadyJob } from './types.ts';
import type { Browser } from 'playwright';

const HELP = `
jobhelp-autoapply — fill job application forms from the queue

USAGE
  node src/cli.ts [options]

OPTIONS
  --batch <n>              Max jobs to process (default: 8)
  --concurrency <n>        Parallel tabs (default: 1)
  --auto-submit            Auto-submit when form is fully deterministic
  --dry-run                Fill but never submit
  --prefill                Deterministic pass only; write leftovers.json, leave tabs open
  --job <jobId>            Process only this job from the queue
  --headless               Run browser headless (default: headful)
  --freeform-timeout <s>   Seconds to wait for freeform-answers.json (default: 0)
  --cdp <endpoint>         Attach to existing browser via CDP instead of launching
                           (e.g. http://localhost:9222); tabs survive CLI exit
  --url <url>              Ad-hoc job URL (bypasses queue; requires --dir)
  --dir <path>             Job directory for ad-hoc job
  --company <name>         Company name for ad-hoc job (default: adhoc)
  --role <name>            Role name for ad-hoc job (default: adhoc)
  --resume-md <path>       Markdown resume for conversion (ad-hoc job)
  --resume <path>          Pre-built PDF/DOCX to upload directly (ad-hoc job, when no --resume-md)
  --ats <name>             Force ATS adapter by name (needed for localhost fixture URLs)
  --help                   Show this help

ENVIRONMENT
  JOBHELP_CDP_PORT         Default CDP port for --cdp / browser-daemon (default: 9222)
  JOBHELP_SLOWMO           Milliseconds of slow-mo between playwright actions
  JOBHELP_HOME             Override state directory (default: ~/jobhelp)
  JOBHELP_CONFIG_DIR       Override config directory (default: ~/.config/jobhelp)
`.trim();

interface CliOptions {
  batch: number;
  concurrency: number;
  autoSubmit: boolean;
  dryRun: boolean;
  prefill: boolean;
  job?: string;
  headful: boolean;
  freeformWaitMs: number;
  cdp?: string;
  url?: string;
  dir?: string;
  company: string;
  role: string;
  resumeMd?: string;
  resume?: string;
  ats?: string;
  help: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      batch: { type: 'string', default: '8' },
      concurrency: { type: 'string', default: '1' },
      'auto-submit': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      prefill: { type: 'boolean', default: false },
      job: { type: 'string' },
      headless: { type: 'boolean', default: false },
      'freeform-timeout': { type: 'string', default: '0' },
      cdp: { type: 'string' },
      url: { type: 'string' },
      dir: { type: 'string' },
      company: { type: 'string', default: 'adhoc' },
      role: { type: 'string', default: 'adhoc' },
      'resume-md': { type: 'string' },
      resume: { type: 'string' },
      ats: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const batch = Number.parseInt(String(values.batch), 10);
  const concurrency = Number.parseInt(String(values.concurrency), 10);
  return {
    batch: Number.isFinite(batch) && batch > 0 ? batch : 8,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
    autoSubmit: values['auto-submit'] === true,
    dryRun: values['dry-run'] === true,
    prefill: values['prefill'] === true,
    ...(values.job !== undefined ? { job: String(values.job) } : {}),
    headful: values.headless !== true,
    freeformWaitMs: Math.max(0, Number.parseInt(String(values['freeform-timeout']), 10) || 0) * 1000,
    ...(values.cdp !== undefined ? { cdp: String(values.cdp) } : {}),
    ...(values.url !== undefined ? { url: String(values.url) } : {}),
    ...(values.dir !== undefined ? { dir: String(values.dir) } : {}),
    company: String(values.company ?? 'adhoc'),
    role: String(values.role ?? 'adhoc'),
    ...(values['resume-md'] !== undefined ? { resumeMd: String(values['resume-md']) } : {}),
    ...(values.resume !== undefined ? { resume: String(values.resume) } : {}),
    ...(values.ats !== undefined ? { ats: String(values.ats) } : {}),
    help: values.help === true,
  };
}

import { copyFile } from 'node:fs/promises';
import { ADAPTERS_BY_NAME } from './ats/registry.ts';

async function resolveJobs(opts: CliOptions): Promise<ReadyJob[]> {
  if (opts.url !== undefined) {
    if (opts.dir === undefined) {
      console.error('--url requires --dir');
      process.exit(1);
    }
    if (opts.resumeMd === undefined && opts.resume === undefined) {
      console.error('--url requires --resume-md <path> or --resume <path>');
      process.exit(1);
    }
    if (opts.ats !== undefined && !ADAPTERS_BY_NAME.has(opts.ats)) {
      const valid = [...ADAPTERS_BY_NAME.keys()].sort().join(', ');
      console.error(`Unknown --ats "${opts.ats}". Valid names: ${valid}`);
      process.exit(1);
    }
    const resumeMdPath = opts.resumeMd ?? opts.resume ?? '';
    return [
      {
        jobId: `adhoc-${Date.now()}`,
        company: opts.company,
        role: opts.role,
        url: opts.url,
        dir: opts.dir,
        resumeMdPath,
      },
    ];
  }

  let profile;
  try {
    profile = await loadProfile(profilePath());
  } catch (e: unknown) {
    log('error', 'profile load failed', { error: e instanceof Error ? e.message : String(e) });
    console.error(`\nCreate ${profilePath()} with your standing answers (firstName, email, etc.).`);
    process.exit(1);
  }
  void profile;

  return selectReadyJobs({
    stateFile: stateFilePath(),
    sidecar: statusSidecarPath(),
    limit: opts.batch,
    ...(opts.job !== undefined ? { onlyJobId: opts.job } : {}),
  });
}

async function openBrowser(opts: CliOptions): Promise<{ browser: Browser; cdpMode: boolean }> {
  const endpoint = opts.cdp ?? process.env['JOBHELP_CDP'];
  if (endpoint) {
    const browser = await connectBrowser(endpoint);
    return { browser, cdpMode: true };
  }
  const browser = await launchBrowser(opts.headful);
  return { browser, cdpMode: false };
}

function pickAtsForJob(url: string, forceName?: string) {
  if (forceName !== undefined) {
    return ADAPTERS_BY_NAME.get(forceName) ?? null;
  }
  return pickAts(url);
}

async function main(): Promise<number> {
  const opts = parseCli(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  let profile;
  try {
    profile = await loadProfile(profilePath());
  } catch (e: unknown) {
    log('error', 'profile load failed', { error: e instanceof Error ? e.message : String(e) });
    console.error(`\nCreate ${profilePath()} with your standing answers (firstName, email, etc.).`);
    return 1;
  }

  const jobs = await resolveJobs(opts);
  if (jobs.length === 0) {
    console.log('Nothing ready to apply to (need a supported ATS url + a tailored resume).');
    return 0;
  }

  const { browser, cdpMode } = await openBrowser(opts);

  const rows: RunRow[] = [];
  const runStart = Date.now();
  try {
    await runPool(jobs, opts.concurrency, async (job) => {
      const ats = pickAtsForJob(job.url, opts.ats);
      if (!ats) {
        log('warn', 'no adapter for url; skipping', { jobId: job.jobId, url: job.url });
        return;
      }

      const useDirectResume = opts.url !== undefined && opts.resumeMd === undefined && opts.resume !== undefined;
      const directResumePath = opts.resume;
      const converter = useDirectResume && directResumePath !== undefined
        ? { convert: async (_md: string, out: string) => { await copyFile(directResumePath, out); } }
        : renderJakestyleConverter;

      const deps: ApplyDeps = {
        ats,
        converter,
        sidecarPath: statusSidecarPath(),
        autoSubmit: opts.autoSubmit,
        dryRun: opts.dryRun,
        prefill: opts.prefill,
        freeformWaitMs: opts.freeformWaitMs,
        now: () => new Date().toISOString(),
      };

      const page = await newTab(browser, cdpMode);
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

  if (cdpMode) {
    return 0;
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
