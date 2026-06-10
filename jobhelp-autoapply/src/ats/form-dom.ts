import type { Locator, Page } from 'playwright';
import {
  CAPTCHA,
  DEFAULT_REACT_SELECT,
  type AtsConfig,
  type DetectedField,
  type ReactSelectClasses,
  type Surface,
} from './form-config.ts';
import { byKey } from './locate.ts';
import { fillReactSelect } from './react-select.ts';

// Facade: keep the form-dom import surface stable for adapters and the
// greenhouse-dom shim while the dropdown logic lives in react-select.ts.
export { byKey } from './locate.ts';
export * from './react-select.ts';

/** Prefer the main page when it already holds the form (the common hosted case)
 * and only descend into an iframe that actually contains the form. Matching a
 * stray iframe (recaptcha, analytics) silently breaks fill/validate. */
export async function surfaceOf(page: Page, cfg: AtsConfig): Promise<Surface> {
  if ((await page.locator(cfg.formSelector).count()) > 0) return page;
  if (cfg.iframeSelector) {
    const handle = await page.$(cfg.iframeSelector);
    if (handle) {
      const frame = await handle.contentFrame();
      if (frame) {
        // A real embedded form (Greenhouse) hydrates after the host settles, so a
        // single immediate count loses the race. Wait, bounded, for it to attach.
        const timeout = Number(process.env.JOBHELP_IFRAME_MS) || 8000;
        await frame.locator(cfg.formSelector).first().waitFor({ state: 'attached', timeout }).catch(() => undefined);
        if ((await frame.locator(cfg.formSelector).count()) > 0) return frame;
      }
    }
  }
  return page;
}

/** Resolve the application form as a Locator so descendant queries scope to it.
 * Real SPA pages (Ashby) render the fields with no `<form>` at all; falling back to
 * a bare `form` locator there resolves to nothing and any later `.evaluate()` on it
 * waits out the full implicit timeout (~30s) before failing. So when neither the
 * configured selector nor a bare `form` is present, scope to the page root instead.
 * Every branch is gated on a bounded `count()` — never an implicit element wait. */
export async function formScope(surface: Surface, cfg: AtsConfig): Promise<Locator> {
  const forms = surface.locator(cfg.formSelector);
  if ((await forms.count()) > 0) return forms.first();
  const bare = surface.locator('form');
  if ((await bare.count()) > 0) return bare.first();
  return surface.locator('body').first();
}

export async function captchaPresent(surface: Surface): Promise<boolean> {
  return (await surface.locator(CAPTCHA).count()) > 0;
}

/** Ids of file inputs in the form that have no file attached. Treated as required
 * for gating: a present upload field with nothing in it blocks submit. */
export async function fileInputsMissingUpload(surface: Surface, cfg: AtsConfig): Promise<string[]> {
  const form = await formScope(surface, cfg);
  return form.locator('input[type=file]').evaluateAll((els) =>
    (els as HTMLInputElement[])
      .filter((el) => !el.files || el.files.length === 0)
      .map((el) => el.getAttribute('id') ?? el.getAttribute('name') ?? 'file'),
  );
}

/** Required choice groups with nothing selected, by readable label. Covers both
 * native `input[type=radio|checkbox][required]` groups and SPA aria groups
 * (`[role=radiogroup|group][aria-required]` with no `aria-checked`/`aria-selected`
 * descendant) — the latter have no native input, so detection/validate would
 * otherwise miss them and a required choice could pass unanswered. */
export async function requiredUncheckedGroups(surface: Surface, cfg: AtsConfig): Promise<string[]> {
  const form = await formScope(surface, cfg);
  return form.evaluate((root) => {
    const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
    // Turn a machine key (snake/camel/kebab/bracketed) into a readable fallback so
    // an unlabelled blocker is still identifiable instead of empty.
    const humanize = (key: string): string =>
      clean(
        key
          .replace(/\[[^\]]*\]/g, ' ')
          .replace(/[_-]+/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2'),
      );
    const out: string[] = [];
    const groups: Record<string, { required: boolean; checked: boolean; label: string }> = {};
    root.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((node) => {
      const el = node as HTMLInputElement;
      const name = el.name || el.id || '';
      const group = (groups[name] ??= { required: false, checked: false, label: '' });
      if (el.required) group.required = true;
      if (el.checked) group.checked = true;
      if (!group.label) group.label = clean(el.closest('fieldset')?.querySelector('legend')?.textContent ?? '');
    });
    for (const [name, g] of Object.entries(groups)) {
      if (g.required && !g.checked) out.push(g.label || humanize(name) || 'required choice');
    }
    root.querySelectorAll('[role="radiogroup"][aria-required="true"], [role="group"][aria-required="true"]').forEach((grp) => {
      // Only real choice groups: a file-upload or text wrapper can also be
      // role=group[aria-required] (e.g. a resume dropzone), and flagging it as an
      // unchecked choice is a false positive — the upload/field is validated
      // elsewhere. Require actual selectable options before treating it as a group.
      if (!grp.querySelector('[role="radio"], [role="checkbox"], [role="option"], input[type="radio"], input[type="checkbox"]')) return;
      if (grp.querySelector('[aria-checked="true"], [aria-selected="true"]')) return;
      const lbl =
        grp.getAttribute('aria-label') ??
        (grp.getAttribute('aria-labelledby')
          ? root.ownerDocument.getElementById(grp.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''
          : grp.querySelector('label, legend, [class*="label"]')?.textContent ?? '');
      const fallback = humanize(grp.getAttribute('name') ?? grp.getAttribute('id') ?? '');
      out.push(clean(lbl) || fallback || 'required choice');
    });
    return out;
  });
}

export interface ScalarResult {
  readonly ok: boolean;
  readonly guess?: { fieldKey: string; question: string; answer: string; reason: 'dropdown' };
}

/** Fill one non-file control by its DOM kind. A react-select that lands on a
 * fuzzy option reports a flagged guess so the caller can park it for review. */
export async function fillScalar(
  surface: Surface,
  field: DetectedField,
  value: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
): Promise<ScalarResult> {
  if (field.reactSelect) {
    const r = await fillReactSelect(surface, field.id, value, rs);
    if (!r.selected) return { ok: false };
    if (r.guessed) {
      return {
        ok: true,
        guess: { fieldKey: field.id, question: field.label, answer: r.chosen ?? value, reason: 'dropdown' },
      };
    }
    return { ok: true };
  }
  if (field.tag === 'select') {
    const ok = await byKey(surface, field.id)
      .selectOption({ label: value }, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    return { ok };
  }
  const input = byKey(surface, field.id);
  await input.fill(value);
  // A React-controlled input can revert to empty on its own change handler, so
  // re-read to confirm the value stuck. Non-empty (not strict equality): some
  // inputs mask/reformat the value, which equality would wrongly reject.
  const landed = await input.inputValue().catch(() => '');
  return { ok: landed.trim() !== '' };
}
