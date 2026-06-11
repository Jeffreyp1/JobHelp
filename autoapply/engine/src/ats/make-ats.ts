import type { Locator, Page } from 'playwright';
import type { Ats, FillOutcome, ValidationOutcome } from './types.ts';
import type { FreeformQuestion, GuessedField, StandingProfile } from '../types.ts';
import { DEFAULT_REACT_SELECT, type AtsConfig, type DetectedField, type Surface } from './form-config.ts';
import { classifyLabel, answerFor } from '../match.ts';
import { detectChoiceGroups, fillChoiceGroup } from './choice-groups.ts';
import {
  byKey,
  surfaceOf,
  formScope,
  fillScalar,
  readSelectOptions,
  readNativeOptions,
  reactSelectSelected,
  applyAnswer,
  captchaPresent,
  fileInputsMissingUpload,
  requiredUncheckedGroups,
} from './form-dom.ts';

const DEFAULT_COVER_RE = /cover/i;
const DEFAULT_RESUME_RE = /resume|\bcv\b/i;
const DEFAULT_APPLY_RE = /apply|i'?m interested/i;
// Cookie-specific wording only — a bare "Accept"/"Agree" could be a terms or form
// button, and clicking it before the form loads would be a real side effect.
const CONSENT_RE = /accept all|accept cookies|allow all cookies|allow cookies|got it/i;

const DEFAULT_SUBMIT_CONFIRM_MS = 8000;
const submitConfirmMs = (): number => Number(process.env.JOBHELP_SUBMIT_CONFIRM_MS) || DEFAULT_SUBMIT_CONFIRM_MS;
const SUCCESS_TEXT_RE =
  /thank you|application (was )?(received|submitted|sent)|we('| ha)?ve received|submitted successfully|successfully (applied|submitted)/i;

/** Thrown by submit() when the click produced no observable success signal. The
 * orchestrator treats this as terminal-but-unverified (do not retry: the send may
 * have gone through) — distinct from a click failure, which is retryable. */
export const SUBMIT_NOT_CONFIRMED = 'submit not confirmed';

/** Wait for a real success signal after the submit click: a navigation away, a
 * NEW confirmation message, or the form detaching. `startUrl` and `successBefore`
 * are sampled BEFORE the click so pre-existing page copy (a "thank you for your
 * interest" blurb) can't be mistaken for proof of a send. The form may detach on
 * success, so a per-poll timeout swallows detached-frame errors. */
async function awaitSubmitConfirmed(
  page: Page,
  form: Locator,
  startUrl: string,
  successBefore: boolean,
  deadline: number,
): Promise<boolean> {
  const success = page.locator('body', { hasText: SUCCESS_TEXT_RE });
  while (Date.now() < deadline) {
    if (page.url() !== startUrl) return true;
    if (!successBefore && (await success.count().catch(() => 0)) > 0) return true;
    if (!(await form.isVisible().catch(() => false))) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Build the handoff question for a field the tool couldn't fill itself. Reads
 * options for fixed-list dropdowns; async autocompletes and text fields become
 * free-text questions. */
async function openQuestionFor(
  surface: Surface,
  field: DetectedField,
  cfg: AtsConfig,
): Promise<FreeformQuestion> {
  if (field.tag === 'textarea') return { fieldKey: field.id, label: field.label, kind: 'textarea' };
  if (field.reactSelect) {
    const options = await readSelectOptions(surface, field.id, cfg.reactSelect ?? DEFAULT_REACT_SELECT);
    if (options.length > 0) return { fieldKey: field.id, label: field.label, kind: 'select', options };
  } else if (field.tag === 'select') {
    const options = await readNativeOptions(surface, field.id);
    if (options.length > 0) return { fieldKey: field.id, label: field.label, kind: 'select', options };
  }
  return { fieldKey: field.id, label: field.label, kind: 'text' };
}

function valueFor(field: DetectedField, profile: StandingProfile, cfg: AtsConfig): string | undefined {
  const resolved = cfg.resolveValue?.(field, profile);
  if (resolved !== undefined) return resolved;
  const concept = classifyLabel(field.label);
  return concept ? answerFor(concept, profile) : undefined;
}

/** Produce an `Ats` from a declarative config + a detection strategy. All the
 * browser behavior (open, fill, freeform handoff, validate, submit) is shared;
 * adapters only differ in their selectors and how they enumerate fields. */
export function makeAts(cfg: AtsConfig): Ats {
  const rs = cfg.reactSelect ?? DEFAULT_REACT_SELECT;
  const coverRe = cfg.coverRe ?? DEFAULT_COVER_RE;
  const applyRe = cfg.applyButtonRe ?? DEFAULT_APPLY_RE;
  const isCoverField = (id: string, label: string): boolean =>
    (coverRe.test(id) || coverRe.test(label)) && !(DEFAULT_RESUME_RE.test(id) || DEFAULT_RESUME_RE.test(label));

  return {
    name: cfg.name,

    matches(url: string): boolean {
      return cfg.urlRe.test(url);
    },

    async openForm(page: Page, url: string): Promise<void> {
      await page.goto(cfg.normalizeUrl?.(url) ?? url, { waitUntil: 'domcontentloaded' });
      // Consent walls overlay the page and intercept clicks (including the apply
      // reveal below), so dismiss one first. Best-effort: a missing or stale button
      // must not block the open.
      const consent = page.locator('button', { hasText: CONSENT_RE }).first();
      if ((await consent.count().catch(() => 0)) > 0) {
        await consent.click({ timeout: 2000 }).catch(() => undefined);
      }
      const surface = await surfaceOf(page, cfg);
      const form = surface.locator(cfg.formSelector).first();
      if ((await form.count()) === 0) {
        const apply = surface.locator('a, button', { hasText: applyRe }).first();
        if ((await apply.count()) > 0) await apply.click().catch(() => undefined);
      }
      // Only wait on a form that actually exists. Some ATSs (Ashby) render the
      // application without a <form>, where waiting would just burn the full timeout.
      if ((await form.count()) > 0) {
        await form.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
      }
      // Wait for the SPA to finish hydrating before filling. Fields set too early
      // get reset when hydration runs. networkidle is the practical signal.
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    },

    async fill(page: Page, profile: StandingProfile, resumeFilePath: string): Promise<FillOutcome> {
      const surface = await surfaceOf(page, cfg);
      if (cfg.beforeFill) await cfg.beforeFill(surface, profile, cfg);
      const fields = await cfg.detect(surface, cfg);
      let filledKnown = 0;
      let resumeUploaded = false;
      const freeform: FreeformQuestion[] = [];
      const guesses: GuessedField[] = [];

      for (const field of fields) {
        // Radio/checkbox choice groups can't be auto-picked or satisfied by a text
        // answer; leave them to requiredUncheckedGroups (validate) instead of a dead
        // handoff that would strand the job in needs_freeform. (Mirrors validate.)
        if (field.type === 'radio' || field.type === 'checkbox') continue;
        if (field.type === 'file') {
          // Resolve the input ONCE to a handle. Setting a file makes these forms
          // re-render and detach the input, so re-resolving the locator afterwards
          // (e.g. to confirm the upload) auto-waits the full ~30s for it to
          // reappear. Operating on a captured handle skips that wait entirely; a
          // detached node just makes the read throw fast -> parks as a blocker.
          const handle = await byKey(surface, field.id).elementHandle({ timeout: 8000 }).catch(() => null);
          if (handle) {
            if (isCoverField(field.id, field.label)) {
              if (profile.coverLetterPath) {
                await handle.setInputFiles(profile.coverLetterPath, { timeout: 8000 }).catch(() => undefined);
              }
            } else if (!resumeUploaded) {
              await handle.setInputFiles(resumeFilePath, { timeout: 8000 }).catch(() => undefined);
              resumeUploaded = await handle
                .evaluate((el) => ((el as HTMLInputElement).files?.length ? true : false))
                .catch(() => false);
            }
          }
          continue;
        }

        const value = valueFor(field, profile, cfg);
        if (value !== undefined) {
          const result = await fillScalar(surface, field, value, rs);
          if (result.ok) {
            filledKnown += 1;
            if (result.guess) guesses.push(result.guess);
            continue;
          }
        }

        // Unfilled: hand EVERY non-file field to the session so nothing is silently
        // skipped — it decides per field whether to fill, blank, or decline.
        freeform.push(await openQuestionFor(surface, field, cfg));
      }

      // Choice groups (radio/checkbox) aren't in `fields` — detect-controls skips
      // them. Auto-select the option matching a profile value (EEO, yes/no); an
      // unmatched group stays unselected for validate's requiredUncheckedGroups.
      for (const group of await detectChoiceGroups(surface, cfg)) {
        const concept = classifyLabel(group.label);
        const value = concept ? answerFor(concept, profile) : undefined;
        if (value === undefined) continue;
        const r = await fillChoiceGroup(surface, group, value);
        if (r.ok) {
          filledKnown += 1;
          if (r.guessed) {
            guesses.push({ fieldKey: group.key, question: group.label, answer: r.chosen ?? value, reason: 'dropdown' });
          }
        }
      }

      return { filledKnown, freeform, guesses, resumeUploaded };
    },

    async applyFreeform(page: Page, answers: Record<string, string>): Promise<readonly string[]> {
      const surface = await surfaceOf(page, cfg);
      const applied: string[] = [];
      for (const [fieldKey, answer] of Object.entries(answers)) {
        if (answer !== '' && (await applyAnswer(surface, fieldKey, answer, rs))) applied.push(fieldKey);
      }
      return applied;
    },

    async validate(page: Page): Promise<ValidationOutcome> {
      const surface = await surfaceOf(page, cfg);
      const captcha = await captchaPresent(surface);
      const fields = await cfg.detect(surface, cfg);
      const blockers: string[] = [];
      for (const field of fields) {
        if (!field.required) continue;
        if (field.type === 'file' || field.type === 'radio' || field.type === 'checkbox') continue;
        if (field.reactSelect) {
          if (!(await reactSelectSelected(surface, field.id, rs))) blockers.push(field.label || field.id);
          continue;
        }
        const value = await byKey(surface, field.id).inputValue().catch(() => '');
        if (value.trim() === '') blockers.push(field.label || field.id);
      }
      for (const id of await fileInputsMissingUpload(surface, cfg)) blockers.push(id);
      for (const label of await requiredUncheckedGroups(surface, cfg)) blockers.push(label);
      return { ok: blockers.length === 0 && !captcha, blockers, captcha };
    },

    async submit(page: Page): Promise<void> {
      const surface = await surfaceOf(page, cfg);
      // Scope the submit click to the form so a broad fallback selector can't match
      // an unrelated page button (newsletter, modal) on an SPA landing page.
      const form = await formScope(surface, cfg);
      // Sample the URL and any confirmation text BEFORE clicking, so only a CHANGE
      // counts as proof — pre-existing "thank you" copy can't false-confirm.
      const startUrl = page.url();
      const successBefore = (await page.locator('body', { hasText: SUCCESS_TEXT_RE }).count().catch(() => 0)) > 0;
      await form.locator(cfg.submitSelector).first().click();
      // A click on a wrong/disabled button is silent; only a real success signal
      // (navigation, a new confirmation message, or the form detaching) proves the send.
      const confirmed = await awaitSubmitConfirmed(page, form, startUrl, successBefore, Date.now() + submitConfirmMs());
      if (!confirmed) throw new Error(SUBMIT_NOT_CONFIRMED);
    },
  };
}
