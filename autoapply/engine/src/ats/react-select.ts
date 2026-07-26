import {
  DEFAULT_PROBE_BUDGET_MS,
  DEFAULT_REACT_SELECT,
  type ReactSelectClasses,
  type Surface,
} from './form-config.ts';
import { byKey } from './locate.ts';
import { chooseOption, probeSequence } from './option-match.ts';
import type { Locator } from 'playwright';

export { chooseOption, isDeclineValue, probeSequence, DECLINE_RE, POLARITY_TOKENS } from './option-match.ts';

const PROBE_MENU_TIMEOUT_MS = 2500;
const READ_MENU_TIMEOUT_MS = 1500;
const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scope the option query to the listbox a combobox input explicitly owns via
 * `aria-controls`/`aria-owns`, so a stray always-visible `[role=option]` widget
 * elsewhere on the page can't leak into the pick. react-select frequently PORTALS
 * its menu outside the form, so we DON'T scope to the form — only to an explicit
 * input→listbox relationship. With no such relationship we fall back to the
 * surface-wide query (the inline-menu case every existing fixture uses). */
async function optionsFor(
  surface: Surface,
  input: Locator,
  rs: ReactSelectClasses,
): Promise<Locator> {
  const listboxId = await input
    .evaluate((el) => el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns'))
    .catch(() => null);
  if (listboxId !== null && listboxId !== '') {
    const esc = listboxId.replace(/[\\"]/g, '\\$&');
    const listbox = surface.locator(`[id="${esc}"]`);
    if ((await listbox.count().catch(() => 0)) > 0) return listbox.locator(rs.option);
  }
  return surface.locator(rs.option);
}

export type MenuOutcome = 'options' | 'empty' | 'none';

/** Wait for a combobox menu to settle: real options, a "no options" notice, or
 * nothing. A visible loading indicator extends the wait past `baseTimeout` (a
 * lookup mid-flight is evidence a real menu is coming) but never past `deadline`
 * — the field's overall probe budget. */
export async function awaitMenuOutcome(
  surface: Surface,
  options: Locator,
  rs: ReactSelectClasses,
  baseTimeout: number,
  deadline: number,
): Promise<MenuOutcome> {
  const first = options.first();
  const noOptions = surface.locator(rs.noOptions).first();
  const loading = rs.loading === undefined ? null : surface.locator(rs.loading).first();
  const softDeadline = Date.now() + baseTimeout;
  for (;;) {
    // Read loading BEFORE options: when a lookup finishes between the two reads
    // we still see the options it just rendered, never a spurious bail.
    const loadingVisible = loading === null ? false : await loading.isVisible().catch(() => false);
    if (await first.isVisible().catch(() => false)) return 'options';
    if (await noOptions.isVisible().catch(() => false)) return 'empty';
    const now = Date.now();
    if (now >= deadline) return 'none';
    if (!loadingVisible && now >= softDeadline) return 'none';
    await sleep(POLL_MS);
  }
}

export interface ReactSelectResult {
  readonly selected: boolean;
  readonly guessed: boolean;
  readonly chosen?: string;
}

async function pickFrom(
  surface: Surface,
  input: Locator,
  value: string,
  timeout: number,
  rs: ReactSelectClasses,
  deadline: number,
): Promise<ReactSelectResult> {
  const options = await optionsFor(surface, input, rs);
  const outcome = await awaitMenuOutcome(surface, options, rs, timeout, deadline);
  if (outcome !== 'options' && (await options.count()) === 0) {
    return { selected: false, guessed: false };
  }
  const texts = (await options.allTextContents()).map((t) => t.trim());
  const { idx, exact } = chooseOption(texts, value);
  if (idx === -1) return { selected: false, guessed: false };
  await options.nth(idx).click();
  const chosen = texts[idx];
  if (chosen !== undefined && chosen !== '') {
    await input
      .evaluate((el, c) => el.setAttribute('data-jobhelp-selected', c), chosen)
      .catch(() => undefined);
  }
  return { selected: true, guessed: !exact, ...(chosen !== undefined ? { chosen } : {}) };
}

/** Drive a react-select: type the value and click the matching option. These are
 * often async autocompletes that only return options matching what's typed, so
 * when the full value matches nothing we retry with shorter probes to surface
 * candidates, then pick the closest to the full value — a flagged guess. The
 * whole loop is capped by `probeBudgetMs`; on exhaustion the field falls to the
 * caller's freeform/handoff path. */
export async function fillReactSelect(
  surface: Surface,
  id: string,
  value: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
): Promise<ReactSelectResult> {
  const input = byKey(surface, id);
  await input.click();
  const deadline = Date.now() + (rs.probeBudgetMs ?? DEFAULT_PROBE_BUDGET_MS);
  for (const probe of probeSequence(value)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // fill(), not pressSequentially: react-select reacts to fill's input event
    // (the clear below has always depended on that) without the per-char delay.
    await input.fill(probe);
    const res = await pickFrom(surface, input, value, Math.min(PROBE_MENU_TIMEOUT_MS, remaining), rs, deadline);
    if (res.selected) return res;
  }
  // Leave a failed combobox empty so `reactSelectSelected` can't read the last
  // probe's leftover text as a (false) selection.
  await input.evaluate((el) => el.removeAttribute('data-jobhelp-selected')).catch(() => undefined);
  await input.fill('').catch(() => undefined);
  await input.press('Escape').catch(() => undefined);
  return { selected: false, guessed: false };
}

/** Open a dropdown without typing and read its visible options. Fixed lists show
 * all options; async autocompletes show none (return []). Resolves as soon as the
 * menu settles — options, "no options", or a dead base wait — extending only
 * while a loading indicator is visible. Capped. */
export async function readSelectOptions(
  surface: Surface,
  id: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
  cap = 30,
): Promise<string[]> {
  const input = byKey(surface, id);
  await input.click().catch(() => undefined);
  const options = await optionsFor(surface, input, rs);
  const deadline = Date.now() + (rs.probeBudgetMs ?? DEFAULT_PROBE_BUDGET_MS);
  const outcome = await awaitMenuOutcome(surface, options, rs, READ_MENU_TIMEOUT_MS, deadline);
  const texts =
    outcome === 'options'
      ? (await options.allTextContents().catch(() => [] as string[])).map((t) => t.trim()).filter(Boolean)
      : [];
  await input.press('Escape').catch(() => undefined);
  return texts.slice(0, cap);
}

/** Read the visible options of a native <select> (skipping the empty/placeholder
 * first option), so a handed-off native dropdown carries its choices. Capped. */
export async function readNativeOptions(surface: Surface, id: string, cap = 30): Promise<string[]> {
  const texts = await byKey(surface, id)
    .locator('option')
    .evaluateAll((opts) =>
      (opts as HTMLOptionElement[])
        .filter((o) => o.value !== '' && o.textContent !== null && o.textContent.trim() !== '')
        .map((o) => (o.textContent ?? '').trim()),
    )
    .catch(() => [] as string[]);
  return texts.slice(0, cap);
}

/** Fill a native <select>: exact label first, then chooseOption over its real
 * options. Select by the MATCHED OPTION'S TEXT — readNativeOptions filters
 * placeholder options, so an index into its list points at the wrong raw
 * <option>. */
export async function fillNativeSelect(
  surface: Surface,
  id: string,
  value: string,
): Promise<ReactSelectResult> {
  const el = byKey(surface, id);
  const trySelect = (label: string): Promise<boolean> =>
    el.selectOption({ label }, { timeout: 2000 }).then(() => true).catch(() => false);
  if (await trySelect(value)) return { selected: true, guessed: false, chosen: value };
  const texts = await readNativeOptions(surface, id);
  const { idx, exact } = chooseOption(texts, value);
  const chosen = idx === -1 ? undefined : texts[idx];
  if (chosen === undefined || !(await trySelect(chosen))) return { selected: false, guessed: false };
  return { selected: true, guessed: !exact, chosen };
}

/** Apply a session-provided answer to a field, dispatching by its DOM kind, and
 * VERIFY it actually landed. Returns false if the field couldn't be found or the
 * value didn't take — so callers never report an answer that didn't apply. */
export async function applyAnswer(
  surface: Surface,
  id: string,
  answer: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
): Promise<boolean> {
  const info = await byKey(surface, id)
    .evaluate((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') }))
    .catch(() => null);
  if (info === null) return false;
  if (info.role === 'combobox') {
    await fillReactSelect(surface, id, answer, rs);
    return reactSelectSelected(surface, id, rs);
  }
  if (info.tag === 'select') {
    const res = await fillNativeSelect(surface, id, answer);
    if (!res.selected) return false;
    const value = await byKey(surface, id).inputValue().catch(() => '');
    return value.trim() !== '';
  }
  await byKey(surface, id).fill(answer).catch(() => undefined);
  const value = await byKey(surface, id).inputValue().catch(() => '');
  return value.trim() !== '';
}

/** A combobox is "selected" once it shows a single-value marker (classic
 * react-select, which clears the input on pick) OR retains the chosen text as its
 * own value (Ashby/Workable-style). The union covers both families. */
export async function reactSelectSelected(
  surface: Surface,
  id: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
): Promise<boolean> {
  return byKey(surface, id)
    .evaluate((inp, sv) => {
      const control = inp.closest('[class*="select__control"]') ?? inp.closest('[class*="-control"]');
      if (control?.querySelector(sv)) return true;
      const value = ((inp as HTMLInputElement).value ?? '').trim();
      const placeholders = [
        inp.getAttribute('aria-placeholder'),
        (inp as HTMLInputElement).placeholder,
        control?.querySelector('[class*="placeholder"]')?.textContent,
      ];
      if (value !== '') return !placeholders.some((p) => (p ?? '').trim() === value);
      // Class names drift with site redesigns; the pick stamp does not. Trust it
      // only while the chosen text is still visible near the input, so a re-render
      // that wiped the selection cannot ride a stale stamp through validate.
      const stamped = (inp.getAttribute('data-jobhelp-selected') ?? '').trim();
      if (stamped === '') return false;
      let node: Element | null = inp.parentElement;
      for (let depth = 0; node !== null && depth < 3; depth += 1, node = node.parentElement) {
        if ((node.textContent ?? '').includes(stamped)) return true;
      }
      return false;
    }, rs.singleValue)
    .catch(() => false);
}
