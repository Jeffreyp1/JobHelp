import type { Ats } from './types.ts';
import type { AtsConfig } from './form-config.ts';
import { detectControls } from './detect-controls.ts';
import { makeAts } from './make-ats.ts';

/** Workable (apply.workable.com) — a React SPA whose inputs carry `input_*` ids
 * wired with label[for] and whose dropdowns are classic react-select (`select__*`).
 * Control-first detection plus the default combobox driver handle both. */
export const workableConfig: AtsConfig = {
  name: 'workable',
  urlRe: /workable\.com/i,
  formSelector: 'form',
  submitSelector: 'button[type="submit"], button[data-ui="submit-application"]',
  detect: detectControls,
};

export const workable: Ats = makeAts(workableConfig);
