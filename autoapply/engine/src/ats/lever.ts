import type { Ats } from './types.ts';
import type { AtsConfig } from './form-config.ts';
import { detectControls } from './detect-controls.ts';
import { makeAts } from './make-ats.ts';

/** Lever (jobs.lever.co) — a server-rendered form. Standard fields are named
 * (name/email/phone/urls[…]); custom questions live in `.application-question`
 * blocks with a sibling `.application-label`, which control-first detection reads. */
export const leverConfig: AtsConfig = {
  name: 'lever',
  urlRe: /(?:^|\.)lever\.co/i,
  formSelector: 'form.application-form, form[data-qa*="application"], form[action*="/apply"]',
  submitSelector: '.template-btn-submit, button[type="submit"], input[type="submit"]',
  detect: detectControls,
};

export const lever: Ats = makeAts(leverConfig);
