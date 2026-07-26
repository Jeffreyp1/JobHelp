import type { Ats } from './types.ts';
import type { AtsConfig } from './form-config.ts';
import { detectByLabelFor } from './detect-label-for.ts';
import { detectToggleGroups } from './choice-groups.ts';
import { makeAts } from './make-ats.ts';

/** Ashby (jobs.ashbyhq.com) — a React SPA. Standard fields carry `_systemfield_*`
 * ids wired with label[for]; dropdowns are role="combobox" listboxes that keep the
 * chosen text in the input. Scalar fields are wired with `label[for]`, so
 * label-based detection is the right strategy and yields clean labels — but the
 * resume input is a hidden `input[type=file]` behind an Upload button with no
 * label wiring, which fill() reaches by enumerating file inputs directly. The
 * real /application route renders no `<form>` at all — `formScope` page-scopes to
 * body when the `form` selector is absent, so detection still finds the fields. */
export const ashbyConfig: AtsConfig = {
  name: 'ashby',
  urlRe: /ashbyhq\.com/i,
  formSelector: 'form',
  submitSelector: 'button[type="submit"]',
  detect: detectByLabelFor,
  // Required booleans (work auth, sponsorship, onsite) render as styled BUTTON
  // pairs with no native input, no role and no aria-pressed; selection is only
  // an `_act…` CSS-module class, which the default toggle selector matches.
  detectToggleGroups,
  // Stored job URLs usually point at the overview route, which renders the
  // posting (no fields) behind an Application tab; /application is the form.
  normalizeUrl(url: string): string {
    const m = /^(https:\/\/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36})\/?$/i.exec(url.split('?')[0] ?? '');
    return m?.[1] !== undefined ? `${m[1]}/application` : url;
  },
};

export const ashby: Ats = makeAts(ashbyConfig);
