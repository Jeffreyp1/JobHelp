import type { Locator } from 'playwright';
import type { Surface } from './form-config.ts';

/** Locate a control by its stable key, matching either its id or its name. Most
 * ATSs id their inputs; some (e.g. Lever) only name them, so accept both. Keys can
 * contain brackets (`cards[q1][field0]`); escape the quote/backslash chars that
 * would otherwise break out of the quoted attribute value. */
export function byKey(surface: Surface, key: string): Locator {
  const esc = key.replace(/[\\"]/g, '\\$&');
  return surface.locator(`[id="${esc}"], [name="${esc}"]`).first();
}
