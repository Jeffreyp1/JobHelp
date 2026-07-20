import type { Locator } from 'playwright';
import type { Surface } from './form-config.ts';

/** Locate a control by its stable key: its id, its name, or the data-jobhelp-key
 * that detection stamps on controls that have neither. Most ATSs id their inputs;
 * some (e.g. Lever) only name them. Keys can contain brackets
 * (`cards[q1][field0]`); escape the quote/backslash chars that would otherwise
 * break out of the quoted attribute value. */
export function byKey(surface: Surface, key: string): Locator {
  const esc = key.replace(/[\\"]/g, '\\$&');
  return surface.locator(`[id="${esc}"], [name="${esc}"], [data-jobhelp-key="${esc}"]`).first();
}
