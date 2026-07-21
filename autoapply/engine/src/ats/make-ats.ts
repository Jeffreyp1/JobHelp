import type { Locator, Page } from 'playwright';
import type { Ats, FillOutcome, ValidationOutcome } from './types.ts';
import type { StandingProfile } from '../types.ts';
import { DEFAULT_REACT_SELECT, type AtsConfig, type DetectedField, type ReactSelectClasses } from './form-config.ts';
import { withSelectorOverrides } from '../selector-overrides.ts';
import { classifyLabelWithRules, loadLabelOverrides, answerFor } from '../match.ts';
import { lookupApproved } from '../answer-bank.ts';
import { detectChoiceGroups, fillChoiceGroup } from './choice-groups.ts';
import { uploadFiles } from './upload.ts';
import { EEO_CONCEPTS, eeoOption } from './eeo.ts';
import { fillDetectedFields } from './fill-fields.ts';
import { captureRepair, type RepairCapture } from '../repair-artifact.ts';
import {
  SUCCESS_TEXT_RE,
  SUBMIT_NOT_CONFIRMED,
  submitConfirmMs,
  awaitSubmitConfirmed,
} from './submit-confirm.ts';
import {
  byKey,
  surfaceOf,
  formScope,
  fillableControlCount,
  reactSelectSelected,
  applyAnswer,
  captchaPresent,
  fileInputsMissingUpload,
  requiredUncheckedGroups,
  resolveSubmitButton,
} from './form-dom.ts';

export { SUBMIT_NOT_CONFIRMED } from './submit-confirm.ts';

const DEFAULT_COVER_RE = /cover/i;
const DEFAULT_RESUME_RE = /resume|\bcv\b/i;
const DEFAULT_APPLY_RE = /apply|i'?m interested/i;
// Cookie-specific wording only — a bare "Accept"/"Agree" could be a terms or form
// button, and clicking it before the form loads would be a real side effect.
const CONSENT_RE = /accept all|accept cookies|allow all cookies|allow cookies|got it/i;

const FORM_ATTACH_MS = 10000;
const DEFAULT_HYDRATION_IDLE_MS = 2500;
const hydrationIdleMs = (): number => Number(process.env.JOBHELP_HYDRATION_IDLE_MS) || DEFAULT_HYDRATION_IDLE_MS;

// Fill-time verified uploads, per page: SPA forms (Ashby) clear input.files on the
// post-upload re-render, so validate's re-read would report a false blocker.
const verifiedUploads = new WeakMap<Page, Set<string>>();

interface DetectSnapshot {
  fields: readonly DetectedField[];
  controlCount: number;
  stale: boolean;
}

/** Produce an `Ats` from a declarative config + a detection strategy. All the
 * browser behavior (open, fill, freeform handoff, validate, submit) is shared;
 * adapters only differ in their selectors and how they enumerate fields. */
export function makeAts(cfg0: AtsConfig): Ats {
  const eff = (): { cfg: AtsConfig; rs: ReactSelectClasses } => {
    const cfg = withSelectorOverrides(cfg0);
    return { cfg, rs: cfg.reactSelect ?? DEFAULT_REACT_SELECT };
  };
  const coverRe = cfg0.coverRe ?? DEFAULT_COVER_RE;
  const applyRe = cfg0.applyButtonRe ?? DEFAULT_APPLY_RE;
  const isCoverField = (id: string, label: string): boolean =>
    (coverRe.test(id) || coverRe.test(label)) && !(DEFAULT_RESUME_RE.test(id) || DEFAULT_RESUME_RE.test(label));
  // Detection costs evaluate roundtrips and runs twice per job (fill, validate).
  // Validate reuses fill's result unless the form could have changed: SPA forms
  // reveal conditional fields, so a changed fillable-control count or an applied
  // freeform/select answer forces a re-detect.
  const detectCache = new WeakMap<Page, DetectSnapshot>();

  const open = async (page: Page, url: string): Promise<void> => {
    const { cfg } = eff();
    detectCache.delete(page);
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
      if ((await apply.count()) > 0) {
        await apply.click().catch(() => undefined);
        // count() does not wait and SPA forms attach a beat after the reveal
        // click, so wait for the form — or, on form-less ATSs (Ashby), its
        // first control — to attach before re-checking.
        await surface
          .locator(`${cfg.formSelector}, input, select, textarea`)
          .first()
          .waitFor({ state: 'attached', timeout: FORM_ATTACH_MS })
          .catch(() => undefined);
      }
    }
    // Only wait on a form that actually exists. Some ATSs (Ashby) render the
    // application without a <form>, where waiting would just burn the full timeout.
    if ((await form.count()) > 0) {
      await form.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    }
    // Hydration guard: fields set before the SPA hydrates get their values
    // reset. With images/fonts/analytics blocked per tab, networkidle usually
    // fires fast; the short cap keeps tracker-heavy pages (which never reach
    // idle) from turning this into a per-job floor. A hydration reset that
    // slips past it is still caught: fills read their values back and
    // validate re-checks every required field before the gate.
    await page.waitForLoadState('networkidle', { timeout: hydrationIdleMs() }).catch(() => undefined);
  };

  return {
    name: cfg0.name,

    matches(url: string): boolean {
      return cfg0.urlRe.test(url);
    },

    openForm: open,

    async probe(page: Page, url: string): Promise<{ fields: number; submitFound: boolean }> {
      const { cfg } = eff();
      await open(page, url);
      const surface = await surfaceOf(page, cfg);
      const fields = await cfg.detect(surface, cfg);
      const toggles = cfg.detectToggleGroups === undefined ? [] : await cfg.detectToggleGroups(surface, cfg);
      const form = await formScope(surface, cfg);
      const submitFound = (await resolveSubmitButton(surface, form, cfg)) !== null;
      return { fields: fields.length + toggles.length, submitFound };
    },

    async captureRepair(page: Page): Promise<RepairCapture> {
      const { cfg } = eff();
      return captureRepair(page, cfg);
    },

    async fill(page: Page, profile: StandingProfile, resumeFilePath: string): Promise<FillOutcome> {
      const { cfg, rs } = eff();
      await loadLabelOverrides();
      const surface = await surfaceOf(page, cfg);
      if (cfg.beforeFill) await cfg.beforeFill(surface, profile, cfg);
      // File inputs are enumerated directly from the form scope, not via
      // cfg.detect — SPA forms (Ashby) hide the input behind an Upload button
      // with no label[for] wiring, so detection never returns it.
      const upload = await uploadFiles({ surface, cfg, resumeFilePath, profile, isCover: isCoverField });
      if (upload.verifiedKeys.length > 0) {
        const set = verifiedUploads.get(page) ?? new Set<string>();
        for (const k of upload.verifiedKeys) set.add(k);
        verifiedUploads.set(page, set);
      }
      const fields = await cfg.detect(surface, cfg);
      detectCache.set(page, { fields, controlCount: await fillableControlCount(surface, cfg), stale: false });
      const filled = await fillDetectedFields(surface, cfg, fields, profile, rs);
      const { freeform, guesses } = filled;

      // Choice groups (radio/checkbox) aren't in `fields` — detect-controls skips
      // them. Auto-select the option matching a profile value (EEO, yes/no); an
      // unmatched group stays unselected for validate's requiredUncheckedGroups.
      // Adapter toggle groups (styled button pairs, aria radiogroups) join the
      // same loop; ones already carrying a selection are left alone.
      const toggles = cfg.detectToggleGroups === undefined ? [] : await cfg.detectToggleGroups(surface, cfg);
      for (const group of [...(await detectChoiceGroups(surface, cfg)), ...toggles]) {
        if (group.checked === true) continue;
        const concept = classifyLabelWithRules(group.label, cfg.name);
        const profileValue = concept ? answerFor(concept, profile, group.label) : undefined;
        const replay =
          profileValue === undefined ? await lookupApproved(group.label, group.options.map((o) => o.label)) : null;
        const value = profileValue ?? replay?.answer;
        if (value === undefined) continue;
        let target = value;
        let declined = false;
        // The EEO decline-or-blank remap translates profile-style values; a bank
        // answer is already the concrete option text the human approved.
        if (profileValue !== undefined && concept !== null && EEO_CONCEPTS.has(concept)) {
          const choice = eeoOption(group.options.map((o) => o.label), value);
          if (choice === null) continue;
          target = choice.pick;
          declined = choice.declined;
        }
        const r = await fillChoiceGroup(surface, group, target);
        if (r.ok) {
          filled.filledKnown += 1;
          if (r.guessed || declined || (replay !== null && !replay.exact)) {
            guesses.push({ fieldKey: group.key, question: group.label, answer: r.chosen ?? target, reason: 'dropdown' });
          }
        }
      }

      return { filledKnown: filled.filledKnown, freeform, guesses, resumeUploaded: upload.resumeUploaded };
    },

    async applyFreeform(page: Page, answers: Record<string, string>): Promise<readonly string[]> {
      const { cfg, rs } = eff();
      const surface = await surfaceOf(page, cfg);
      const applied: string[] = [];
      for (const [fieldKey, answer] of Object.entries(answers)) {
        if (answer !== '' && (await applyAnswer(surface, fieldKey, answer, rs))) applied.push(fieldKey);
      }
      if (applied.length > 0) {
        const snapshot = detectCache.get(page);
        if (snapshot !== undefined) snapshot.stale = true;
      }
      return applied;
    },

    async validate(page: Page): Promise<ValidationOutcome> {
      const { cfg, rs } = eff();
      const surface = await surfaceOf(page, cfg);
      const captcha = await captchaPresent(surface);
      const cached = detectCache.get(page);
      let fields: readonly DetectedField[];
      if (cached !== undefined && !cached.stale && (await fillableControlCount(surface, cfg)) === cached.controlCount) {
        fields = cached.fields;
      } else {
        fields = await cfg.detect(surface, cfg);
        detectCache.set(page, { fields, controlCount: await fillableControlCount(surface, cfg), stale: false });
      }
      const blockers: string[] = [];
      for (const field of fields) {
        // Fail closed: a control that couldn't be keyed can't be filled OR read
        // back, so its state is unknown regardless of the required marker.
        if (field.id === '') {
          blockers.push(field.label !== '' ? field.label : 'unkeyed control');
          continue;
        }
        if (!field.required) continue;
        if (field.type === 'file' || field.type === 'radio' || field.type === 'checkbox') continue;
        if (field.reactSelect) {
          if (!(await reactSelectSelected(surface, field.id, rs))) blockers.push(field.label || field.id);
          continue;
        }
        const value = await byKey(surface, field.id).inputValue().catch(() => '');
        if (value.trim() === '') blockers.push(field.label || field.id);
      }
      const verified = verifiedUploads.get(page);
      for (const id of await fileInputsMissingUpload(surface, cfg)) {
        // A fill-time verified upload is authoritative: Ashby clears input.files
        // on its post-upload re-render, so this re-read would false-block forever.
        if (verified?.has(id)) continue;
        blockers.push(id);
      }
      for (const label of await requiredUncheckedGroups(surface, cfg)) blockers.push(label);
      if (cfg.detectToggleGroups !== undefined) {
        // Fail closed: these widgets have no native inputs (and Ashby's button
        // pairs no roles either), so requiredUncheckedGroups cannot see them and
        // an unanswered required toggle would otherwise pass the gate silently.
        for (const g of await cfg.detectToggleGroups(surface, cfg)) {
          if (!g.required || g.checked === true) continue;
          const label = g.label !== '' ? g.label : g.key;
          if (!blockers.includes(label)) blockers.push(label);
        }
      }
      return { ok: blockers.length === 0 && !captcha, blockers, captcha };
    },

    async submit(page: Page): Promise<void> {
      const { cfg } = eff();
      const surface = await surfaceOf(page, cfg);
      // Scope the submit click to the form so a broad fallback selector can't match
      // an unrelated page button (newsletter, modal) on an SPA landing page.
      const form = await formScope(surface, cfg);
      // Sample the URL and any confirmation text BEFORE clicking, so only a CHANGE
      // counts as proof — pre-existing "thank you" copy can't false-confirm.
      const startUrl = page.url();
      const successBefore = (await page.locator('body', { hasText: SUCCESS_TEXT_RE }).count().catch(() => 0)) > 0;
      const button = await resolveSubmitButton(surface, form, cfg);
      if (button === null) throw new Error('submit button not found');
      await button.click();
      // A click on a wrong/disabled button is silent; only a real success signal
      // (navigation, a new confirmation message, or the form detaching) proves the send.
      const confirmed = await awaitSubmitConfirmed(page, form, startUrl, successBefore, Date.now() + submitConfirmMs());
      if (!confirmed) throw new Error(SUBMIT_NOT_CONFIRMED);
    },

    async submitConfigured(page: Page): Promise<boolean> {
      // Whether the adapter's DECLARED submit selector still matches. When it does
      // not, resolveSubmitButton would click a button inferred on the fly; the gate
      // treats that like a repaired-selectors run and parks instead of auto-submitting.
      const { cfg } = eff();
      const surface = await surfaceOf(page, cfg);
      const form = await formScope(surface, cfg);
      return (await form.locator(cfg.submitSelector).count().catch(() => 0)) > 0;
    },
  };
}
