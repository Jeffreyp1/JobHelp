import type { Page } from 'playwright';
import type { Ats, FilledField, ValidationOutcome } from './ats/types.ts';
import { SUBMIT_NOT_CONFIRMED } from './ats/make-ats.ts';
import type { ApplyStatus, GuessedField, ReadyJob, ReviewReport, StandingProfile, StatusRecord } from './types.ts';
import type { ResumeConverter } from './convert.ts';
import { docxPathForJob } from './convert.ts';
import { setStatus } from './status.ts';
import { writeQuestions, readAnswers } from './freeform.ts';
import { buildReport, failedReport, type RunRow } from './review.ts';
import { buildArtifact, writeArtifact } from './review-artifact.ts';
import { conversionNotes, waitForAnswers } from './apply-support.ts';
import { buildLeftovers, writeLeftovers } from './leftovers.ts';
import { unblockForReview } from './leftovers-watch.ts';
import { hasSelectorOverride } from './selector-overrides.ts';
import { writeRepairArtifact } from './repair-artifact.ts';
import { repairRoot } from './paths.ts';

export function decideGate(i: {
  autoSubmit: boolean;
  uploaded: boolean;
  validation: ValidationOutcome;
  repaired: boolean;
  submitDrifted: boolean;
}): 'submit' | 'pause' {
  // Repaired selectors mean the page changed underneath us; a human reviews
  // every fill made through an override, no matter how clean it looks.
  if (i.repaired) return 'pause';
  // The submit button no longer matches the configured selector, so an auto-submit
  // would click a button inferred on the fly — park for review, same as a repair.
  if (i.submitDrifted) return 'pause';
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
  /** Overrides the converted-resume path; lets ad-hoc --resume uploads keep
   * their real extension instead of landing in the .docx slot. */
  uploadPath?: string;
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

  const docxPath = deps.uploadPath ?? docxPathForJob(job.dir);
  try {
    await deps.converter.convert(job.resumeMdPath, docxPath);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'conversion failed';
    await record('failed', { error });
    return row('failed', failedReport(error));
  }
  await record('converted', { resumeDocxPath: docxPath });
  const notes = await conversionNotes(job);
  const repaired = hasSelectorOverride(deps.ats.name);
  if (repaired) notes.push('repaired selectors active - review before submitting');

  // Anything from here drives the live browser and can throw; on any failure
  // record 'failed' so the job is never left misrepresented (e.g. stuck at
  // 'converted') and is retryable on the next run.
  try {
    await deps.ats.openForm(page, job.url);
    const outcome = await deps.ats.fill(page, profile, docxPath);

    if (outcome.filledKnown === 0 && !outcome.resumeUploaded && outcome.freeform.length === 0) {
      const capture = await deps.ats.captureRepair?.(page).catch(() => undefined);
      if (capture !== undefined) {
        await writeRepairArtifact(
          repairRoot(),
          { ats: deps.ats.name, url: job.url, failure: 'no fields detected', capture },
          deps.now(),
        ).catch(() => undefined);
      }
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
        notes,
      });
      await writeLeftovers(job.dir, leftovers);
      await writeArtifact(job.dir, buildArtifact({
        jobId: job.jobId,
        company: job.company,
        role: job.role,
        url: job.url,
        fields: outcome.fields,
        blockers: validation.blockers,
        captcha: validation.captcha,
        now: deps.now,
        notes,
      }));
      await unblockForReview(page);
      await record('prefilled', { resumeDocxPath: docxPath, guessed: [...outcome.guesses] });
      return row('prefilled', buildReport({
        green: outcome.filledKnown - outcome.guesses.length,
        guessed: [...outcome.guesses],
        blockers: validation.blockers,
        captcha: validation.captcha,
        notes,
      }));
    }

    const guessed: GuessedField[] = [...outcome.guesses];
    const drafted: FilledField[] = [];
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
              const reason = q.kind === 'select' ? 'dropdown' : 'freeform';
              guessed.push({ fieldKey: q.fieldKey, question: q.label, answer: a, reason });
              drafted.push({
                fieldKey: q.fieldKey,
                question: q.label,
                value: a,
                source: 'drafted',
                reason,
                ...(q.options !== undefined ? { options: q.options } : {}),
              });
              freeformAnswered += 1;
            }
          }
        }
      }
    }
    const unansweredFreeform = outcome.freeform.length > freeformAnswered;
    const validation = await deps.ats.validate(page);
    // Adapters expose whether their declared submit selector still matches; an
    // adapter without the hook is treated as configured (no drift signal).
    const submitConfigured = (await deps.ats.submitConfigured?.(page)) ?? true;
    if (!submitConfigured) notes.push('submit selector drifted - review before submitting');
    const report = buildReport({
      green: outcome.filledKnown - outcome.guesses.length,
      guessed,
      blockers: validation.blockers,
      captcha: validation.captcha,
      notes,
    });
    await writeArtifact(job.dir, buildArtifact({
      jobId: job.jobId,
      company: job.company,
      role: job.role,
      url: job.url,
      fields: [...outcome.fields, ...drafted],
      blockers: validation.blockers,
      captcha: validation.captcha,
      now: deps.now,
      notes,
    }));
    const gate = decideGate({
      // A best-guess answer (a fuzzy dropdown pick or a session-drafted essay)
      // always parks for review; auto-submit only fires on a fully deterministic form.
      autoSubmit: deps.autoSubmit && !deps.dryRun && guessed.length === 0,
      uploaded: outcome.resumeUploaded,
      validation,
      repaired,
      submitDrifted: !submitConfigured,
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

    // The pause gate is where the tab is parked for human review; 'filled_parked'
    // keeps it out of the re-queue (the human may submit from the parked tab).
    // A dry run closes the browser instead of parking, so it stays re-queueable.
    if (!deps.dryRun) await unblockForReview(page);
    const status: ApplyStatus = unansweredFreeform ? 'needs_freeform' : deps.dryRun ? 'filled' : 'filled_parked';
    await record(status, { resumeDocxPath: docxPath, guessed });
    return row(status, report);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'application failed';
    await record('failed', { error });
    return row('failed', failedReport(error));
  }
}
