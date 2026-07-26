import type { Ats } from './types.ts';
import type { AtsConfig } from './form-config.ts';
import { detectControls } from './detect-controls.ts';
import { makeAts } from './make-ats.ts';

/** Recruitee (<slug>.recruitee.com) — a labelled candidate form (name/email/phone
 * + custom questions). Standard control-first detection applies. */
export const recruiteeConfig: AtsConfig = {
  name: 'recruitee',
  urlRe: /recruitee\.com/i,
  formSelector: 'form#offer-form, form[class*="application"], form',
  submitSelector: 'button[type="submit"], input[type="submit"]',
  detect: detectControls,
};

export const recruitee: Ats = makeAts(recruiteeConfig);
