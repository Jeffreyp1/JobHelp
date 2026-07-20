import type { Locator } from 'playwright';
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
  readonly kind: 'radio' | 'checkbox' | 'button';
  readonly options: readonly ChoiceOption[];
  /** kind='button' only: selector a selected option element matches. */
  readonly selectedSelector?: string;
  /** kind='button' only: whether any option was already selected at detection. */
  readonly checked?: boolean;
}

/** Ashby marks the selected toggle button only with a CSS-module class
 * (`_active_…`/`_act…`) — no aria-pressed, no native input. */
export const DEFAULT_TOGGLE_SELECTED = '[class*="_act"]';

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

/** Styled choice widgets with NO native input: button pairs under a question
 * label (Ashby's required booleans — selection is only a CSS class) and aria
 * radiogroups whose options are role=radio elements. Both are invisible to
 * detect-controls and to requiredUncheckedGroups' native-input walk, so without
 * this they would never be filled and never block validate. Options and groups
 * are stamped with data-jobhelp-key so byKey can address them. */
export async function detectToggleGroups(
  surface: Surface,
  cfg: AtsConfig,
  selectedSelector: string = DEFAULT_TOGGLE_SELECTED,
): Promise<ChoiceGroup[]> {
  const form = await formScope(surface, cfg);
  return form.evaluate((root, sel) => {
    const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const AUX =
      /upload|attach|browse|choose file|select file|autofill|resume|cover|clear|remove|cancel|submit|apply|sign in|log ?in/i;
    const CONTAINER = '[class*="field"], [class*="question"], fieldset, li, [role="group"]';
    const stamp = (el: Element): string => {
      const existing = el.getAttribute('data-jobhelp-key');
      if (existing !== null && existing !== '') return existing;
      const key = `jobhelp-${Math.random().toString(36).slice(2, 10)}`;
      try {
        el.setAttribute('data-jobhelp-key', key);
      } catch {
        return '';
      }
      return el.getAttribute('data-jobhelp-key') === key ? key : '';
    };
    const isRequired = (label: string, el: Element): boolean =>
      label.includes('*') || label.includes('✱') || el.getAttribute('aria-required') === 'true';
    const groups: ChoiceGroup[] = [];

    root.querySelectorAll('[role="radiogroup"]').forEach((grp) => {
      if (grp.querySelector('input[type=radio], input[type=checkbox]') !== null) return;
      const radios = Array.from(grp.querySelectorAll('[role="radio"]'));
      if (radios.length < 2) return;
      let label = clean(grp.getAttribute('aria-label') ?? '');
      const labelledBy = grp.getAttribute('aria-labelledby');
      if (label === '' && labelledBy !== null) {
        label = clean(root.ownerDocument.getElementById(labelledBy)?.textContent ?? '');
      }
      if (label === '') {
        label = clean(grp.closest(CONTAINER)?.querySelector('label, legend, [class*="label"]')?.textContent ?? '');
      }
      groups.push({
        key: stamp(grp),
        label,
        required: isRequired(label, grp),
        kind: 'button',
        selectedSelector: '[aria-checked="true"]',
        checked: radios.some((r) => r.getAttribute('aria-checked') === 'true'),
        options: radios.map((r) => ({ label: clean(r.textContent ?? ''), id: stamp(r), value: '' })),
      });
    });

    const byContainer = new Map<Element, HTMLButtonElement[]>();
    root.querySelectorAll('button').forEach((node) => {
      const btn = node as HTMLButtonElement;
      if (btn.getAttribute('type') === 'submit') return;
      if (btn.closest('[role="radiogroup"]') !== null) return;
      const text = clean(btn.textContent ?? '');
      if (text.length === 0 || text.length > 30 || AUX.test(text)) return;
      const container = btn.closest(CONTAINER);
      if (container === null) return;
      const list = byContainer.get(container) ?? [];
      list.push(btn);
      byContainer.set(container, list);
    });
    byContainer.forEach((btns, container) => {
      if (btns.length < 2 || btns.length > 6) return;
      // A container that also holds a fillable control is a scalar field whose
      // buttons are auxiliary chrome, not a choice group.
      if (container.querySelector('input:not([type=hidden]), select, textarea') !== null) return;
      const label = clean(container.querySelector('label, legend, [class*="label"]')?.textContent ?? '');
      if (label === '') return;
      groups.push({
        key: stamp(container),
        label,
        required: isRequired(label, container),
        kind: 'button',
        selectedSelector: sel,
        checked: btns.some((b) => b.matches(sel)),
        options: btns.map((b) => ({ label: clean(b.textContent ?? ''), id: stamp(b), value: '' })),
      });
    });
    return groups;
  }, selectedSelector);
}

export interface ChoiceFillResult {
  readonly ok: boolean;
  readonly guessed: boolean;
  readonly chosen?: string;
}

const ACTION_TIMEOUT_MS = 1500;

async function settleNative(surface: Surface, opt: ChoiceOption, target: Locator): Promise<boolean> {
  await target.check({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  if (await target.isChecked().catch(() => false)) return true;
  // Styled-checkbox pattern: the input is display:none behind a styled label, so
  // check()/click() on the input time out — the label is the real click target.
  const label =
    opt.id !== ''
      ? surface.locator(`label[for="${opt.id.replace(/[\\"]/g, '\\$&')}"]`).first()
      : target.locator('xpath=ancestor::label[1]');
  await label.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  if (await target.isChecked().catch(() => false)) return true;
  await target
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event('click', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })
    .catch(() => undefined);
  return target.isChecked().catch(() => false);
}

async function settleButton(group: ChoiceGroup, target: Locator): Promise<boolean> {
  await target.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  const sel = group.selectedSelector ?? DEFAULT_TOGGLE_SELECTED;
  return target.evaluate((el, s) => el.matches(s), sel).catch(() => false);
}

/** Select the option in `group` matching `value` and confirm it lands selected —
 * isChecked() for native inputs, the group's selected-marker selector for button
 * toggles. Reports a guess when the match was fuzzy so the caller can park it
 * for review. Returns not-ok (leaving the group for validate to flag) when
 * nothing matches — never picks an arbitrary option. */
export async function fillChoiceGroup(
  surface: Surface,
  group: ChoiceGroup,
  value: string,
): Promise<ChoiceFillResult> {
  const labels = group.options.map((o) => o.label);
  const { idx, exact } = chooseOption(labels, value);
  const opt = idx === -1 ? undefined : group.options[idx];
  if (!opt) return { ok: false, guessed: false };
  const target = opt.id !== '' ? byKey(surface, opt.id) : surface.locator(`input[name="${group.key}"][value="${opt.value}"]`).first();
  const ok = group.kind === 'button' ? await settleButton(group, target) : await settleNative(surface, opt, target);
  if (!ok) return { ok: false, guessed: false };
  return { ok: true, guessed: !exact, ...(opt.label !== '' ? { chosen: opt.label } : {}) };
}
