import { readFile } from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import { pickAts, ADAPTERS_BY_NAME } from './ats/registry.ts';
import { fileInputKey } from './ats/form-dom.ts';
import type { ValidationOutcome } from './ats/types.ts';
import type { GuessedField, McpState, StatusRecord } from './types.ts';
import { loadStatuses, setStatus } from './status.ts';
import { readAnswers } from './freeform.ts';
import { readLeftovers, type LeftoversFile } from './leftovers.ts';
import { log } from './log.ts';
import { unblockPage } from './browser.ts';

export interface WatchJob {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly url: string;
  readonly dir: string;
}

export interface LeftoverCompletionInput {
  readonly jobId: string;
  readonly leftovers: LeftoversFile | null;
  readonly answers: Record<string, string>;
  readonly applied: readonly string[];
  readonly validation: ValidationOutcome;
  readonly fileInputKeys: readonly string[];
  readonly now: () => string;
}

export interface LeftoverCompletion {
  readonly record: StatusRecord;
  readonly blockers: readonly string[];
  readonly notApplied: readonly string[];
}

/** Finalize a prefilled job after session answers were applied to its live tab.
 * A fill-time verified resume upload is authoritative: this runs in a fresh
 * process where the fill run's verified-upload WeakMap is gone, and SPA forms
 * (Ashby) clear input.files on re-render, so re-validate would report the file
 * input as a blocker forever. The status is filled_parked — the tab is parked
 * for human review and must never be re-queued. */
export function buildLeftoverCompletion(i: LeftoverCompletionInput): LeftoverCompletion {
  const staleFileKeys = new Set(i.leftovers?.resumeUploaded === true ? i.fileInputKeys : []);
  const byKey = new Map((i.leftovers?.fields ?? []).map((f) => [f.fieldKey, f]));
  const guessed: GuessedField[] = i.applied.map((fieldKey) => {
    const field = byKey.get(fieldKey);
    return {
      fieldKey,
      question: field?.label ?? fieldKey,
      answer: i.answers[fieldKey] ?? '',
      reason: field?.kind === 'select' ? 'dropdown' : 'freeform',
    };
  });
  return {
    record: { jobId: i.jobId, status: 'filled_parked', updatedAt: i.now(), guessed },
    blockers: i.validation.blockers.filter((b) => !staleFileKeys.has(b)),
    notApplied: Object.keys(i.answers).filter((k) => !i.applied.includes(k)),
  };
}

export async function scanPrefilled(stateFile: string, sidecar: string): Promise<WatchJob[]> {
  const statuses = await loadStatuses(sidecar);
  const prefilled = new Set(
    Object.values(statuses)
      .filter((r) => r.status === 'prefilled')
      .map((r) => r.jobId),
  );
  if (prefilled.size === 0) return [];
  let raw: string;
  try {
    raw = await readFile(stateFile, 'utf8');
  } catch (e: unknown) {
    throw new Error(`cannot read MCP state file ${stateFile}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const state = JSON.parse(raw) as McpState;
  if (state === null || typeof state !== 'object' || !Array.isArray(state.applications)) {
    throw new Error(`MCP state file ${stateFile} is missing an applications[] array`);
  }
  const out: WatchJob[] = [];
  for (const e of state.applications) {
    if (!prefilled.has(e.jobId) || e.url === undefined) continue;
    out.push({ jobId: e.jobId, company: e.company, role: e.role, url: e.url, dir: e.dir });
  }
  return out;
}

export interface WatchDeps {
  readonly scan: () => Promise<readonly WatchJob[]>;
  readonly readAnswers: (dir: string) => Promise<Record<string, string> | null>;
  readonly apply: (job: WatchJob, answers: Record<string, string>) => Promise<void>;
  readonly durationMs: number;
  readonly pollMs: number;
  /** Combined prefill+watch mode passes "the prefill pool is done"; once true
   * AND nothing is pending, the watch exits early instead of running out the
   * clock. Absent, the watch runs the full duration — new jobs may still
   * become prefilled at any time. */
  readonly until?: () => boolean;
}

export interface WatchOutcome {
  readonly applied: readonly WatchJob[];
  readonly failed: readonly { readonly job: WatchJob; readonly error: string }[];
  readonly pending: readonly WatchJob[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function watchLeftovers(deps: WatchDeps): Promise<WatchOutcome> {
  const deadline = Date.now() + deps.durationMs;
  const done = new Set<string>();
  const applied: WatchJob[] = [];
  const failed: { job: WatchJob; error: string }[] = [];
  for (;;) {
    const jobs = await deps.scan();
    for (const job of jobs) {
      if (done.has(job.jobId)) continue;
      const answers = await deps.readAnswers(job.dir);
      if (answers === null) continue;
      // A failed apply is not retried: re-typing into a half-applied form is
      // riskier than surfacing the failure for the session to handle.
      done.add(job.jobId);
      try {
        await deps.apply(job, answers);
        applied.push(job);
      } catch (e: unknown) {
        failed.push({ job, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const pending = jobs.filter((j) => !done.has(j.jobId));
    if (pending.length === 0 && deps.until?.() === true) return { applied, failed, pending };
    if (Date.now() >= deadline) return { applied, failed, pending };
    await sleep(Math.min(deps.pollMs, Math.max(1, deadline - Date.now())));
  }
}

/** Resource blocking (browser.ts) speeds up form loads, but a human reviewing a
 * parked tab must see the real page. Best-effort: a cosmetic unblock failure
 * must never fail a successfully filled job — that would mark it failed,
 * re-queue it, and risk a duplicate fill. */
export async function unblockForReview(page: Page): Promise<void> {
  try {
    await unblockPage(page);
  } catch (e: unknown) {
    log('warn', 'unblock before park failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

async function pageFileInputKeys(page: Page): Promise<string[]> {
  const raw = await page
    .locator('input[type=file]')
    .evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('id') ?? '', name: el.getAttribute('name') ?? '' })));
  return raw.map((r) => fileInputKey(r.id, r.name));
}

export interface LeftoverApplyDeps {
  readonly sidecarPath: string;
  readonly now: () => string;
  readonly forceAts?: string;
}

export interface LeftoverApplyResult {
  readonly jobId: string;
  readonly applied: readonly string[];
  readonly notApplied: readonly string[];
  readonly blockers: readonly string[];
  readonly captcha: boolean;
  readonly title: string;
  readonly url: string;
}

/** Apply session-drafted answers to a job's already-open tab, re-validate, park.
 * Records filled_parked only for real (non-empty) jobIds; ad-hoc single-tab
 * invocations without --job keep their status untouched. Never clicks submit. */
export async function applyLeftoversToTab(
  browser: Browser,
  job: WatchJob,
  answers: Record<string, string>,
  deps: LeftoverApplyDeps,
): Promise<LeftoverApplyResult> {
  const ats = deps.forceAts !== undefined ? ADAPTERS_BY_NAME.get(deps.forceAts) : pickAts(job.url);
  if (!ats) throw new Error(`no adapter for ${deps.forceAts ?? job.url}`);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().startsWith(job.url));
  if (!page) throw new Error(`no open tab matching ${job.url}`);
  const applied = await ats.applyFreeform(page, answers);
  const validation = await ats.validate(page);
  let leftovers: LeftoversFile | null = null;
  if (job.dir !== '') {
    try {
      leftovers = await readLeftovers(job.dir);
    } catch (e: unknown) {
      // Fail-safe: without a readable leftovers file the stale upload blocker
      // stays visible rather than being wrongly filtered.
      log('warn', 'unreadable leftovers file; keeping all blockers', {
        dir: job.dir,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const completion = buildLeftoverCompletion({
    jobId: job.jobId,
    leftovers,
    answers,
    applied,
    validation,
    fileInputKeys: await pageFileInputKeys(page),
    now: deps.now,
  });
  if (job.jobId !== '') await setStatus(deps.sidecarPath, completion.record);
  await unblockForReview(page);
  return {
    jobId: job.jobId,
    applied,
    notApplied: completion.notApplied,
    blockers: completion.blockers,
    captcha: validation.captcha,
    title: await page.title(),
    url: page.url(),
  };
}

export interface RunWatchOpts {
  readonly browser: Browser;
  readonly stateFile: string;
  readonly sidecarPath: string;
  readonly durationMs: number;
  readonly pollMs?: number;
  readonly until?: () => boolean;
  readonly now?: () => string;
}

/** Fully-wired watch loop shared by cli.ts (--watch-leftovers) and
 * apply-leftovers-cli (--watch): as each prefilled job's dir gains
 * freeform-answers.json, apply it to that job's tab and park it. Per-job JSON
 * results stream to stdout so the driving session can react as jobs finish. */
export async function runLeftoverWatch(opts: RunWatchOpts): Promise<WatchOutcome> {
  const now = opts.now ?? ((): string => new Date().toISOString());
  return watchLeftovers({
    scan: () => scanPrefilled(opts.stateFile, opts.sidecarPath),
    // The session writes answer files non-atomically; a half-written file
    // parses as garbage. Treat it as not-ready and re-read it on the next poll.
    readAnswers: async (dir) => {
      try {
        return await readAnswers(dir);
      } catch {
        return null;
      }
    },
    apply: async (job, answers) => {
      const result = await applyLeftoversToTab(opts.browser, job, answers, {
        sidecarPath: opts.sidecarPath,
        now,
      });
      console.log(JSON.stringify(result));
    },
    durationMs: opts.durationMs,
    pollMs: opts.pollMs ?? 2000,
    ...(opts.until !== undefined ? { until: opts.until } : {}),
  });
}
