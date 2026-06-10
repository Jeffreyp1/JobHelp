import type { AtsConfig, Surface } from './form-config.ts';
import { formScope } from './form-dom.ts';
import { byKey } from './locate.ts';
import { chooseOption } from './react-select.ts';

export interface ChoiceOption {
  readonly label: string;
  readonly id: string;
  readonly value: string;
}

export interface ChoiceGroup {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly kind: 'radio' | 'checkbox';
  readonly options: readonly ChoiceOption[];
}

// "Decline to self identify" (Greenhouse EEO) and "prefer not to say" (typical
// profile wording) mean the same opt-out, but share no tokens, so the fuzzy
// matcher won't connect them. This bridges the two so an opt-out profile value
// still selects the form's opt-out option.
const DECLINE_RE = /decline|prefer not|rather not|not to (say|identify|disclose)|do not wish/i;

/** Native radio/checkbox groups with their option labels. `detect-controls`
 * deliberately skips choice inputs (auto-picking a free text answer into a radio
 * is unsafe); this reads them as real selectable groups so a profile value can be
 * matched to an option and chosen. aria-only groups (no native input) stay with
 * `requiredUncheckedGroups` for the human. */
export async function detectChoiceGroups(surface: Surface, cfg: AtsConfig): Promise<ChoiceGroup[]> {
  const form = await formScope(surface, cfg);
  return form.evaluate((root) => {
    const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const optionLabel = (el: HTMLInputElement): string => {
      const id = el.id;
      if (id) {
        const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent) return clean(l.textContent);
      }
      const wrap = el.closest('label');
      if (wrap?.textContent) return clean(wrap.textContent);
      const aria = el.getAttribute('aria-label');
      if (aria) return clean(aria);
      return clean(el.value ?? '');
    };
    const groupLabel = (el: HTMLInputElement): string =>
      clean(
        el.closest('fieldset')?.querySelector('legend')?.textContent ??
          el.closest('[class*="question"], [class*="field"], li, [role="group"]')
            ?.querySelector('label, legend, [class*="label"]')?.textContent ??
          '',
      );
    const groups: Record<string, ChoiceGroup & { options: ChoiceOption[] }> = {};
    root.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((node) => {
      const el = node as HTMLInputElement;
      const key = el.name || el.id || '';
      if (!key) return;
      const g = (groups[key] ??= {
        key,
        label: '',
        required: false,
        kind: el.type as 'radio' | 'checkbox',
        options: [],
      });
      if (el.required) (g as { required: boolean }).required = true;
      if (!g.label) (g as { label: string }).label = groupLabel(el);
      g.options.push({ label: optionLabel(el), id: el.id, value: el.value });
    });
    return Object.values(groups);
  });
}

export interface ChoiceFillResult {
  readonly ok: boolean;
  readonly guessed: boolean;
  readonly chosen?: string;
}

/** Select the option in `group` matching `value` and confirm it lands checked.
 * Reports a guess when the match was fuzzy so the caller can park it for review.
 * Returns not-ok (leaving the group for validate to flag) when nothing matches —
 * never picks an arbitrary option. */
export async function fillChoiceGroup(
  surface: Surface,
  group: ChoiceGroup,
  value: string,
): Promise<ChoiceFillResult> {
  const labels = group.options.map((o) => o.label);
  let { idx, exact } = chooseOption(labels, value);
  if (idx === -1 && DECLINE_RE.test(value)) {
    idx = labels.findIndex((l) => DECLINE_RE.test(l));
    exact = idx !== -1;
  }
  const opt = idx === -1 ? undefined : group.options[idx];
  if (!opt) return { ok: false, guessed: false };
  const target = opt.id !== '' ? byKey(surface, opt.id) : surface.locator(`input[name="${group.key}"][value="${opt.value}"]`).first();
  await target.check({ timeout: 4000 }).catch(() => target.click({ timeout: 4000 }).catch(() => undefined));
  const checked = await target.isChecked().catch(() => false);
  if (!checked) return { ok: false, guessed: false };
  return { ok: true, guessed: !exact, ...(opt.label !== '' ? { chosen: opt.label } : {}) };
}
