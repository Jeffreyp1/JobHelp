#!/usr/bin/env node
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HELP, parseCli, type CliOptions } from './cli-options.ts';
import { stateFilePath, statusSidecarPath, profilePath } from './paths.ts';
import { loadProfile } from './profile.ts';
import { selectReadyJobs } from './queue.ts';
import { launchBrowser, connectBrowser, newTab } from './browser.ts';
import { pickAts } from './ats/registry.ts';
import { applyOneJob, type ApplyDeps } from './apply.ts';
import { runPool } from './pool.ts';
import { chooseUploadSource, jaketexPdfConverter } from './convert-pdf.ts';
import type { ResumeConverter } from './convert.ts';
import { formatRunSummary, type RunRow } from './review.ts';
import { runLeftoverWatch } from './leftovers-watch.ts';
import { log } from './log.ts';
import type { ReadyJob } from './types.ts';
import type { Browser } from 'playwright';

export { parseCli } from './cli-options.ts';

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

  if (opts.watchLeftoversMs > 0 && !opts.prefill) {
    console.error('--watch-leftovers requires --prefill');
    return 1;
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
  // The watch starts alongside the pool: it re-scans the sidecar each poll, so
  // job 1's session-drafted answers get applied while jobs 2..N are still
  // filling. Rejections are captured immediately — the promise is only awaited
  // after the pool, and an unhandled mid-pool rejection would kill the process.
  let poolDone = false;
  const watch =
    opts.watchLeftoversMs > 0
      ? runLeftoverWatch({
          browser,
          stateFile: stateFilePath(),
          sidecarPath: statusSidecarPath(),
          durationMs: opts.watchLeftoversMs,
          until: () => poolDone,
        }).then(
          (outcome) => ({ ok: true as const, outcome }),
          (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
        )
      : null;
  try {
    await runPool(jobs, opts.concurrency, async (job) => {
      const ats = pickAtsForJob(job.url, opts.ats);
      if (!ats) {
        log('warn', 'no adapter for url; skipping', { jobId: job.jobId, url: job.url });
        return;
      }

      const useDirectResume = opts.url !== undefined && opts.resumeMd === undefined && opts.resume !== undefined;
      const directResumePath = useDirectResume ? opts.resume : undefined;
      let converter: ResumeConverter;
      let uploadPath: string;
      if (directResumePath !== undefined) {
        converter = { convert: async (_md: string, out: string) => { await copyFile(directResumePath, out); } };
        uploadPath = join(job.dir, `resume.autoapply${extname(directResumePath)}`);
      } else {
        const source = chooseUploadSource(job.dir, job.resumeMdPath);
        uploadPath = source.path;
        if (source.kind === 'convert') {
          converter = jaketexPdfConverter;
        } else {
          log('debug', 'using pre-built resume PDF; skipping render', { jobId: job.jobId, kind: source.kind, path: source.path });
          converter = { convert: async () => undefined };
        }
      }

      const deps: ApplyDeps = {
        ats,
        converter,
        sidecarPath: statusSidecarPath(),
        autoSubmit: opts.autoSubmit,
        dryRun: opts.dryRun,
        prefill: opts.prefill,
        freeformWaitMs: opts.freeformWaitMs,
        now: () => new Date().toISOString(),
        uploadPath,
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
    poolDone = true;
    const totalS = (Date.now() - runStart) / 1000;
    const n = Math.max(rows.length, 1);
    const mode = opts.concurrency > 1 ? `parallel x${opts.concurrency}` : 'sequential';
    console.log(`\n${formatRunSummary(rows)}\n`);
    console.log(`[timing] total ${totalS.toFixed(1)}s, ${rows.length} jobs, avg ${(totalS / n).toFixed(1)}s/job (${mode})`);
  }

  if (watch) {
    const res = await watch;
    if (!res.ok) {
      log('error', 'leftover watch failed', { error: res.error });
      return 1;
    }
    const { applied, failed, pending } = res.outcome;
    console.log(`[watch] applied ${applied.length}, failed ${failed.length}, still pending ${pending.length}`);
    for (const f of failed) console.log(`[watch] FAILED ${f.job.jobId}: ${f.error}`);
    if (pending.length > 0) console.log(`[watch] pending: ${pending.map((j) => j.jobId).join(', ')}`);
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

// Guarded so tests can import parseCli without the CLI running against the
// user's real profile, queue, and browser.
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      log('error', 'fatal', { error: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    });
}
