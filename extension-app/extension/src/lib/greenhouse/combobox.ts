/**
 * Greenhouse's job-boards embed renders dropdowns as react-select widgets.
 * `matchOption` (pure, tested) picks the option text that best fits a profile
 * value; `fillCombobox` (DOM, browser-verified) drives the actual widget:
 * focus → type to filter → click the matching option. react-select ignores a
 * plain `.value =`, so we use the native value setter and dispatch the events
 * it listens for.
 */

/** Pick the single option that matches `value`, or null when none/ambiguous. */
export function matchOption(value: string, options: readonly string[]): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const norm = options.map((raw) => ({ raw, low: raw.toLowerCase() }));

  const exact = norm.find((o) => o.low === v);
  if (exact) return exact.raw;

  const starts = norm.filter((o) => o.low.startsWith(v));
  if (starts.length === 1) return starts[0].raw;

  const contains = norm.filter((o) => o.low.includes(v));
  if (contains.length === 1) return contains[0].raw;

  return null;
}

function setNativeValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOptions(root: Document, tries = 12): Promise<HTMLElement[]> {
  for (let i = 0; i < tries; i++) {
    const opts = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
    if (opts.length > 0) return opts;
    await sleep(60);
  }
  return [];
}

/** Best-effort auto-select on a react-select combobox. Returns true if it
 * picked an option. Browser-only; verified manually, not in unit tests. */
export async function fillCombobox(
  input: HTMLInputElement,
  value: string,
  root: Document,
): Promise<boolean> {
  if (!value.trim()) return false;
  input.focus();
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const options = await waitForOptions(root);
  if (options.length === 0) {
    input.blur();
    return false;
  }
  const texts = options.map((o) => (o.textContent ?? '').trim());
  const match = matchOption(value, texts);
  if (!match) {
    input.blur();
    return false;
  }
  const target = options.find((o) => (o.textContent ?? '').trim() === match);
  if (!target) return false;
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.click();
  return true;
}
