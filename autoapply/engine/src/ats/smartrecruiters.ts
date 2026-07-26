import type { Ats } from './types.ts';
import type { AtsConfig } from './form-config.ts';
import { detectControls } from './detect-controls.ts';
import { makeAts } from './make-ats.ts';

/** SmartRecruiters (jobs.smartrecruiters.com) — a labelled application form with
 * native selects for most choice fields. Standard control-first detection applies. */
export const smartRecruitersConfig: AtsConfig = {
  name: 'smartrecruiters',
  urlRe: /smartrecruiters\.com/i,
  formSelector: 'form#application-form, form[name="application"], form',
  submitSelector: 'button[type="submit"], button[data-test="form-submit"]',
  detect: detectControls,
};

export const smartRecruiters: Ats = makeAts(smartRecruitersConfig);
