import type { Page } from 'playwright';
import type { Ats, ValidationOutcome } from './ats/types.ts';
import { SUBMIT_NOT_CONFIRMED } from './ats/make-ats.ts';
import type { ApplyStatus, GuessedField, ReadyJob, ReviewReport, StandingProfile, StatusRecord } from './types.ts';
import type { ResumeConverter } from './convert.ts';
import { docxPathForJob } from './convert.ts';
import { setStatus } from './status.ts';
import { writeQuestions, readAnswers } from './freeform.ts';
import { writeReview, buildReport, failedReport, type RunRow } from './review.ts';
import { buildLeftovers, writeLeftovers } from './leftovers.ts';

export function decideGate(i: {
  autoSubmit: boolean;
  uploaded: boolean;
  validation: ValidationOutcome;
}): 'submit' | 'pause' {
  if (!i.autoSubmit) return 'pause';
  if (!i.uploaded) return 'pause';
  if (i.validation.captcha) return 'pause';
  if (!i.validation.ok) return 'pause';
  return 'submit';
}

export interface ApplyDeps {
  ats: Ats;
  converter: ResumeConverter;
  sidecarPath: string;
  autoSubmit: boolean;
  dryRun: boolean;
  prefill: boolean;
  freeformWaitMs: number;
  now: () => string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForAnswers(dir: string, waitMs: number): Promise<Record<string, string> | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const answers = await readAnswers(dir);
    if (answers) return answers;
    if (Date.now() >= deadline) return null;
    await sleep(500);
  }
}

export async function applyOneJob(
  page: Page,
  job: ReadyJob,
  profile: StandingProfile,
  deps: ApplyDeps,
): Promise<RunRow> {
  const record = (status: ApplyStatus, extra: Partial<StatusRecord> = {}): Promise<void> =>
    setStatus(deps.sidecarPath, { jobId: job.jobId, status, updatedAt: deps.now(), ...extra });
  const row = (status: ApplyStatus, report: ReviewReport): RunRow => ({
    company: job.company, role: job.role, status, report,
  });

  await record('queued');

  const docxPath = docxPathForJob(job.dir);
  try {
    await deps.converter.convert(job.resumeMdPath, docxPath);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'conversion failed';
    await record('failed', { error });
    return row('failed', failedReport(error));
  }
  await record('converted', { resumeDocxPath: docxPath });

  // Anything from here drives the live browser and can throw; on any failure
  // record 'failed' so the job is never left misrepresented (e.g. stuck at
  // 'converted') and is retryable on the next run.
  try {
    await deps.ats.openForm(page, job.url);
    const outcome = await deps.ats.fill(page, profile, docxPath);

    if (outcome.filledKnown === 0 && !outcome.resumeUploaded && outcome.freeform.length === 0) {
      const error = 'no application fields detected (form did not load)';
      await record('failed', { error });
      return row('failed', failedReport(error));
    }

    if (deps.prefill) {
      const validation = await deps.ats.validate(page);
      const leftovers = buildLeftovers({
        url: job.url,
        company: job.company,
        role: job.role,
        outcome,
        validation,
        now: deps.now,
      });
      await writeLeftovers(job.dir, leftovers);
      await record('prefilled', { resumeDocxPath: docxPath, guessed: [...outcome.guesses] });
      return row('prefilled', buildReport({
        green: outcome.filledKnown - outcome.guesses.length,
        guessed: [...outcome.guesses],
        blockers: validation.blockers,
        captcha: validation.captcha,
      }));
    }

    const guessed: GuessedField[] = [...outcome.guesses];
    let freeformAnswered = 0;
    if (outcome.freeform.length > 0) {
      await writeQuestions(job.dir, outcome.freeform);
      const answers = deps.freeformWaitMs > 0 ? await waitForAnswers(job.dir, deps.freeformWaitMs) : await readAnswers(job.dir);
      if (answers) {
        const resolved: Record<string, string> = {};
        for (const q of outcome.freeform) {
          const a = answers[q.fieldKey];
          if (a !== undefined && a !== '') resolved[q.fieldKey] = a;
        }
        if (Object.keys(resolved).length > 0) {
          // Flag only answers that VERIFIABLY landed — never claim an answer the
          // form didn't accept. Unapplied ones stay unanswered and validate catches them.
          const applied = new Set(await deps.ats.applyFreeform(page, resolved));
          for (const q of outcome.freeform) {
            const a = answers[q.fieldKey];
            if (a !== undefined && a !== '' && applied.has(q.fieldKey)) {
              guessed.push({
                fieldKey: q.fieldKey,
                question: q.label,
                answer: a,
                reason: q.kind === 'select' ? 'dropdown' : 'freeform',
              });
              freeformAnswered += 1;
            }
          }
        }
      }
    }
    const unansweredFreeform = outcome.freeform.length > freeformAnswered;
    const validation = await deps.ats.validate(page);
    const report = buildReport({
      green: outcome.filledKnown - outcome.guesses.length,
      guessed,
      blockers: validation.blockers,
      captcha: validation.captcha,
    });
    await writeReview(job.dir, report);
    const gate = decideGate({
      // A best-guess answer (a fuzzy dropdown pick or a session-drafted essay)
      // always parks for review; auto-submit only fires on a fully deterministic form.
      autoSubmit: deps.autoSubmit && !deps.dryRun && guessed.length === 0,
      uploaded: outcome.resumeUploaded,
      validation,
    });

    if (gate === 'submit') {
      try {
        await deps.ats.submit(page);
      } catch (e: unknown) {
        // A click whose success we could not confirm is terminal-but-unverified:
        // record it so a re-run never double-submits a possibly-sent application.
        // Any OTHER submit error (e.g. the button was missing -> nothing sent) is a
        // real failure and falls through to the outer catch -> 'failed' (retryable).
        if (e instanceof Error && e.message === SUBMIT_NOT_CONFIRMED) {
          await record('submitted_unverified', { resumeDocxPath: docxPath, guessed });
          return row('submitted_unverified', report);
        }
        throw e;
      }
      await record('submitted', { resumeDocxPath: docxPath, guessed });
      return row('submitted', report);
    }

    const status: ApplyStatus = unansweredFreeform ? 'needs_freeform' : 'filled';
    await record(status, { resumeDocxPath: docxPath, guessed });
    return row(status, report);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'application failed';
    await record('failed', { error });
    return row('failed', failedReport(error));
  }
}
