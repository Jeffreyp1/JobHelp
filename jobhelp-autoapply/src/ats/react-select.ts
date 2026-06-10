import { DEFAULT_REACT_SELECT, type ReactSelectClasses, type Surface } from './form-config.ts';
import { byKey } from './locate.ts';
import type { Locator } from 'playwright';

function tokens(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(Boolean);
}

// Generic words that appear across many option labels (especially schools), so a
// shared one is no evidence of a real match. "Example State University"
// and "Academy of Art University" share only "of"/"university"; matching on those
// fills the WRONG school. Scoring ignores these and keys on the distinctive words.
const COMMON_TOKENS = new Set([
  'of', 'the', 'at', 'and', 'a', 'an', 'in', 'for', 'to', 'de',
  'university', 'college', 'institute', 'school', 'univ',
]);

function distinctive(toks: readonly string[]): string[] {
  return toks.filter((t) => !COMMON_TOKENS.has(t));
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

/** Pick the option index for `value`. `exact` is true for a direct text match;
 * false means a fuzzy (shared-token) best guess. -1 means no reasonable match. */
export function chooseOption(texts: readonly string[], value: string): { idx: number; exact: boolean } {
  const lc = texts.map((t) => t.trim().toLowerCase());
  const want = value.trim().toLowerCase();
  let idx = lc.findIndex((t) => t === want);
  if (idx === -1) idx = lc.findIndex((t) => t.startsWith(want) || t.startsWith(`${want} `));
  if (idx === -1) idx = lc.findIndex((t) => t.includes(want));
  if (idx !== -1) return { idx, exact: true };
  // Fuzzy fallback: score on DISTINCTIVE token overlap so a shared generic word
  // can't carry a match, and require at least one distinctive hit — leaving a
  // field empty (to flag) is safer than confidently filling the wrong option.
  const wantToks = tokens(want);
  const wantAll = new Set(wantToks);
  const wantDistinct = new Set(distinctive(wantToks));
  const keyOnDistinct = wantDistinct.size > 0;
  let best = -1;
  let bestKey = 0;
  let bestTotal = 0;
  texts.forEach((t, i) => {
    const toks = tokens(t);
    const total = toks.filter((tok) => wantAll.has(tok)).length;
    const key = keyOnDistinct ? distinctive(toks).filter((tok) => wantDistinct.has(tok)).length : total;
    if (key > bestKey || (key === bestKey && total > bestTotal)) {
      bestKey = key;
      bestTotal = total;
      best = i;
    }
  });
  if (bestKey === 0) return { idx: -1, exact: false };
  return { idx: best, exact: false };
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
): Promise<ReactSelectResult> {
  const options = await optionsFor(surface, input, rs);
  // Resolve as soon as EITHER real options render OR a "No options" notice appears
  // — whichever comes first — instead of always waiting out `timeout`.
  const outcome = await Promise.race([
    options.first().waitFor({ state: 'visible', timeout }).then(() => 'options' as const).catch(() => 'none' as const),
    surface.locator(rs.noOptions).first().waitFor({ state: 'visible', timeout }).then(() => 'empty' as const).catch(() => 'none' as const),
  ]);
  if (outcome !== 'options' && (await options.count()) === 0) {
    return { selected: false, guessed: false };
  }
  const texts = (await options.allTextContents()).map((t) => t.trim());
  const { idx, exact } = chooseOption(texts, value);
  if (idx === -1) return { selected: false, guessed: false };
  await options.nth(idx).click();
  const chosen = texts[idx];
  return { selected: true, guessed: !exact, ...(chosen !== undefined ? { chosen } : {}) };
}

function firstToken(value: string): string {
  const m = value.match(/[a-z0-9]+/i);
  return m ? m[0] : value;
}

/** Probe order for an async typeahead. The most DISTINCTIVE words first (longest
 * non-generic tokens — "Austin", "Springfield"): a typeahead keyed on those returns
 * the right option on the FIRST query, while the full value (with punctuation or
 * extra words) and the generic first word ("University") usually miss and cost a
 * full loading -> "No options" round-trip each. chooseOption still compares every
 * candidate against the full value, so leading with a token doesn't weaken the
 * match. Full value and first word follow as fallbacks; '' shows a fixed list's
 * whole set for fuzzy matching. */
function probeSequence(value: string): string[] {
  const distinct = distinctive(tokens(value)).sort((a, b) => b.length - a.length).slice(0, 2);
  return [...new Set([...distinct, value, firstToken(value), ''])];
}

/** Drive a react-select: type the value and click the matching option. These are
 * often async autocompletes that only return options matching what's typed, so
 * when the full value matches nothing we retry with shorter probes to surface
 * candidates, then pick the closest to the full value — a flagged guess. */
export async function fillReactSelect(
  surface: Surface,
  id: string,
  value: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
): Promise<ReactSelectResult> {
  const input = byKey(surface, id);
  await input.click();
  const probes = probeSequence(value);
  for (let i = 0; i < probes.length; i += 1) {
    await input.fill('');
    await input.pressSequentially(probes[i] ?? '', { delay: 15 });
    const res = await pickFrom(surface, input, value, 2500, rs);
    if (res.selected) return res;
  }
  // Leave a failed combobox empty so `reactSelectSelected` can't read the last
  // probe's leftover text as a (false) selection.
  await input.fill('').catch(() => undefined);
  await input.press('Escape').catch(() => undefined);
  return { selected: false, guessed: false };
}

/** Open a dropdown without typing and read its visible options. Fixed lists show
 * all options; async autocompletes show none (return []). Capped. */
export async function readSelectOptions(
  surface: Surface,
  id: string,
  rs: ReactSelectClasses = DEFAULT_REACT_SELECT,
  cap = 30,
): Promise<string[]> {
  const input = byKey(surface, id);
  await input.click().catch(() => undefined);
  const options = await optionsFor(surface, input, rs);
  let texts: string[] = [];
  try {
    await options.first().waitFor({ state: 'visible', timeout: 1500 });
    texts = (await options.allTextContents()).map((t) => t.trim()).filter(Boolean);
  } catch {
    texts = [];
  }
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
    await byKey(surface, id).selectOption({ label: answer }).catch(() => undefined);
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
      if (value === '') return false;
      // A site can pre-seed the input with its own placeholder text; that is not a
      // user selection. Only count the value when it differs from any placeholder.
      const placeholders = [
        inp.getAttribute('aria-placeholder'),
        (inp as HTMLInputElement).placeholder,
        control?.querySelector('[class*="placeholder"]')?.textContent,
      ];
      return !placeholders.some((p) => (p ?? '').trim() === value);
    }, rs.singleValue)
    .catch(() => false);
}
