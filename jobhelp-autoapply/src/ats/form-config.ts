import type { Page, Frame } from 'playwright';
import type { StandingProfile } from '../types.ts';

export type Surface = Page | Frame;

/** A single fillable control discovered on a form. `id` is the value used both to
 * locate the element ([id=…] or [name=…]) and as the freeform handoff key, so it
 * must be stable across fill/validate/applyFreeform. */
export interface DetectedField {
  readonly id: string;
  readonly label: string;
  readonly tag: 'input' | 'textarea' | 'select';
  readonly type: string; // input type, or the tag for textarea/select
  readonly required: boolean;
  readonly reactSelect: boolean;
}

/** Class fragments that identify a react-select-style combobox. Defaults match
 * the classic react-select (`select__*`) family plus the generic `role`/`*Value`
 * variants, which between them cover Greenhouse, Workable, Ashby and friends. */
export interface ReactSelectClasses {
  /** Visible option rows once the menu opens. */
  readonly option: string;
  /** The "no matches" notice — bailing on it turns a dead probe into a fast skip. */
  readonly noOptions: string;
  /** Marker rendered inside the control once a value is chosen. */
  readonly singleValue: string;
}

export const DEFAULT_REACT_SELECT: ReactSelectClasses = {
  option: '.select__option:visible, [role="option"]:visible',
  noOptions:
    '.select__menu-notice--no-options:visible, [class*="menu-notice--no-options"]:visible, [class*="noOptionsMessage"]:visible',
  singleValue: '[class*="select__single-value"], [class*="singleValue"]',
};

export const CAPTCHA = [
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-sitekey]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[title*="captcha" i]',
].join(', ');

/** Everything an adapter must declare to drive a form through the generic engine.
 * The behavior (open/fill/validate/submit) is shared; only these selectors and the
 * field-detection strategy vary per ATS. */
export interface AtsConfig {
  readonly name: string;
  readonly urlRe: RegExp;
  /** Selector(s) that resolve the application <form>. */
  readonly formSelector: string;
  /** Some ATSs embed the form in an iframe on a company career page. */
  readonly iframeSelector?: string;
  readonly submitSelector: string;
  /** Clicked to reveal the form when the page lands on a posting view first. */
  readonly applyButtonRe?: RegExp;
  readonly reactSelect?: ReactSelectClasses;
  /** Matches the cover-letter file input so it is not mistaken for the resume. */
  readonly coverRe?: RegExp;
  /** Enumerate the form's fillable controls. */
  detect(surface: Surface, cfg: AtsConfig): Promise<DetectedField[]>;
  /** Optional pre-fill DOM prep (e.g. add education rows for the whole profile). */
  beforeFill?(surface: Surface, profile: StandingProfile, cfg: AtsConfig): Promise<void>;
  /** Adapter-specific field→value mapping checked before the generic label
   * classifier (e.g. Greenhouse education rows). Return undefined to defer. */
  resolveValue?(field: DetectedField, profile: StandingProfile): string | undefined;
}
